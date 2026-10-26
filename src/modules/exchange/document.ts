import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import type { PurchaseDocumentModel } from "./document-model";

const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 48;
const CONTENT_RIGHT = PAGE_WIDTH - MARGIN;
const CONTENT_WIDTH = CONTENT_RIGHT - MARGIN;
const BOTTOM_LIMIT = 64;

const INK = rgb(0.08, 0.08, 0.08);
const MUTED = rgb(0.42, 0.42, 0.42);
const RULE = rgb(0.84, 0.84, 0.84);

export interface DocumentLogo {
  readonly mime: string;
  readonly data: Uint8Array;
}

interface EmbeddedLogo {
  readonly image: PDFImage;
  readonly width: number;
  readonly height: number;
}

export interface PurchaseDocumentPdf {
  readonly bytes: Uint8Array;
  readonly fileName: string;
}

function sanitize(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[\u202f\u00a0]/g, " ")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[^\x20-\x7e\u00a0-\u00ff\n]/g, "?");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): readonly string[] {
  const lines: string[] = [];
  for (const paragraph of sanitize(text).split("\n")) {
    if (paragraph.trim() === "") {
      lines.push("");
      continue;
    }
    let current = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = current ? `${current} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
        current = candidate;
        continue;
      }
      if (current) {
        lines.push(current);
        current = "";
      }
      if (font.widthOfTextAtSize(word, size) <= maxWidth) {
        current = word;
        continue;
      }
      let chunk = "";
      for (const character of word) {
        if (font.widthOfTextAtSize(chunk + character, size) > maxWidth && chunk) {
          lines.push(chunk);
          chunk = character;
        } else {
          chunk += character;
        }
      }
      current = chunk;
    }
    if (current) {
      lines.push(current);
    }
  }
  return lines;
}

export async function renderPurchaseDocumentPdf(
  model: PurchaseDocumentModel,
  logo?: DocumentLogo | null,
): Promise<PurchaseDocumentPdf> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const ink = INK;
  const muted = MUTED;

  pdf.setTitle(`${model.title} ${model.reference}`);
  pdf.setProducer("Lean");
  pdf.setCreator("Lean");

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);

  const text = (
    target: PDFPage,
    value: string,
    options: {
      x: number;
      y: number;
      size: number;
      useBold?: boolean;
      color?: typeof INK;
      maxWidth?: number;
    },
  ): number => {
    const usedFont = options.useBold ? bold : font;
    const lines = wrapText(value, usedFont, options.size, options.maxWidth ?? CONTENT_WIDTH);
    let cursor = options.y;
    for (const line of lines) {
      target.drawText(line, {
        x: options.x,
        y: cursor,
        size: options.size,
        font: usedFont,
        color: options.color ?? ink,
      });
      cursor -= options.size * 1.35;
    }
    return cursor;
  };

  const rightText = (
    target: PDFPage,
    value: string,
    options: { x: number; y: number; size: number; useBold?: boolean; color?: typeof INK },
  ): number => {
    const usedFont = options.useBold ? bold : font;
    const safe = sanitize(value);
    const width = usedFont.widthOfTextAtSize(safe, options.size);
    target.drawText(safe, {
      x: options.x - width,
      y: options.y,
      size: options.size,
      font: usedFont,
      color: options.color ?? ink,
    });
    return options.y - options.size * 1.35;
  };

  const drawHeader = (target: PDFPage, logoImage: EmbeddedLogo | null) => {
    let leftY = PAGE_HEIGHT - MARGIN - 14;
    const logoWidth = logoImage ? logoImage.width : 0;
    const companyWidth = CONTENT_WIDTH - (logoWidth ? logoWidth + 20 : 0);

    leftY = text(target, model.companyName, {
      x: MARGIN,
      y: leftY,
      size: 16,
      useBold: true,
      maxWidth: companyWidth,
    });
    for (const detail of model.companyDetails) {
      leftY = text(target, detail, {
        x: MARGIN,
        y: leftY - 2,
        size: 8.5,
        color: muted,
        maxWidth: companyWidth,
      });
    }

    let rightY = PAGE_HEIGHT - MARGIN - 14;
    if (logoImage) {
      target.drawImage(logoImage.image, {
        x: CONTENT_RIGHT - logoImage.width,
        y: PAGE_HEIGHT - MARGIN - logoImage.height,
        width: logoImage.width,
        height: logoImage.height,
      });
      rightY = PAGE_HEIGHT - MARGIN - logoImage.height - 18;
    }
    rightY = rightText(target, model.title, {
      x: CONTENT_RIGHT,
      y: rightY,
      size: 15,
      useBold: true,
    });
    rightText(target, model.reference, {
      x: CONTENT_RIGHT,
      y: rightY - 2,
      size: 10,
      color: muted,
    });

    const ruleY = Math.min(leftY, rightY) - 14;
    target.drawLine({
      start: { x: MARGIN, y: ruleY },
      end: { x: CONTENT_RIGHT, y: ruleY },
      thickness: 1,
      color: RULE,
    });
    return ruleY - 24;
  };

  let logoImage: EmbeddedLogo | null = null;
  try {
    logoImage = await embedLogo(pdf, logo ?? null);
  } catch {
    logoImage = null;
  }

  let y = drawHeader(page, logoImage);

  const supplierLabelY = y;
  text(page, "Fournisseur", { x: MARGIN, y: supplierLabelY, size: 8, color: muted });
  y = text(page, model.supplierName, {
    x: MARGIN,
    y: supplierLabelY - 14,
    size: 11,
    useBold: true,
    maxWidth: 280,
  });
  for (const detail of model.supplierDetails) {
    y = text(page, detail, { x: MARGIN, y: y - 1, size: 8.5, color: muted, maxWidth: 280 });
  }

  let metaY = supplierLabelY;
  for (const entry of model.meta) {
    rightText(page, entry.label, { x: 360, y: metaY, size: 8, color: muted });
    metaY = rightText(page, entry.value, {
      x: CONTENT_RIGHT,
      y: metaY,
      size: 9,
      useBold: entry.label === "Référence",
    });
  }

  y = Math.min(y, metaY) - 18;

  const COL = {
    index: MARGIN,
    name: MARGIN + 24,
    qty: 296,
    unit: 304,
    unitPrice: 438,
    total: CONTENT_RIGHT,
  };
  const NAME_WIDTH = COL.qty - COL.name - 10;

  const drawTableHead = (target: PDFPage, startY: number): number => {
    const baseY = startY;
    target.drawLine({
      start: { x: MARGIN, y: baseY + 8 },
      end: { x: CONTENT_RIGHT, y: baseY + 8 },
      thickness: 1.2,
      color: ink,
    });
    target.drawText("N°", { x: COL.index, y: baseY, size: 8, font: bold, color: ink });
    target.drawText("Désignation", { x: COL.name, y: baseY, size: 8, font: bold, color: ink });
    rightText(target, "Qté", { x: COL.qty, y: baseY, size: 8, useBold: true });
    target.drawText("Unité", { x: COL.unit, y: baseY, size: 8, font: bold, color: ink });
    rightText(target, "Prix unitaire", { x: COL.unitPrice, y: baseY, size: 8, useBold: true });
    rightText(target, "Total", { x: COL.total, y: baseY, size: 8, useBold: true });
    return baseY - 12;
  };

  const newPage = () => {
    page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    return PAGE_HEIGHT - MARGIN;
  };

  y = drawTableHead(page, y);

  for (const line of model.lines) {
    const nameLines = wrapText(line.name, font, 9, NAME_WIDTH);
    const rowHeight = Math.max(18, nameLines.length * 11 + 7);
    if (y - rowHeight < BOTTOM_LIMIT) {
      y = newPage();
      y = drawTableHead(page, y);
    }
    const baseline = y - 10;
    page.drawText(String(line.index), { x: COL.index, y: baseline, size: 9, font, color: muted });
    let nameY = baseline;
    for (const nameLine of nameLines) {
      page.drawText(nameLine, { x: COL.name, y: nameY, size: 9, font, color: ink });
      nameY -= 11;
    }
    rightText(page, line.quantity, { x: COL.qty, y: baseline, size: 9 });
    page.drawText(line.unit, { x: COL.unit, y: baseline, size: 9, font, color: ink });
    rightText(page, line.unitPrice, { x: COL.unitPrice, y: baseline, size: 9 });
    rightText(page, line.total, { x: COL.total, y: baseline, size: 9 });
    y -= rowHeight;
    page.drawLine({
      start: { x: MARGIN, y: y + 4 },
      end: { x: CONTENT_RIGHT, y: y + 4 },
      thickness: 0.5,
      color: RULE,
    });
  }

  if (y - 24 < BOTTOM_LIMIT) {
    y = newPage();
  }
  y -= 8;
  page.drawLine({
    start: { x: MARGIN, y: y + 4 },
    end: { x: CONTENT_RIGHT, y: y + 4 },
    thickness: 1.2,
    color: ink,
  });
  rightText(page, "Total", { x: COL.unitPrice, y: y - 12, size: 10, useBold: true });
  rightText(page, model.totalLabel, { x: COL.total, y: y - 12, size: 12, useBold: true });
  y -= 38;

  const ensureSpace = (needed: number) => {
    if (y - needed < BOTTOM_LIMIT) {
      y = newPage();
    }
  };

  if (model.conditions.length > 0) {
    ensureSpace(28);
    y = text(page, "Conditions", { x: MARGIN, y, size: 9, useBold: true });
    for (const condition of model.conditions) {
      y = text(page, condition, { x: MARGIN, y: y - 1, size: 8.5, color: muted, maxWidth: 420 });
    }
    y -= 6;
  }

  if (model.bank.length > 0) {
    ensureSpace(28);
    y = text(page, "Coordonnées bancaires", { x: MARGIN, y, size: 9, useBold: true });
    for (const bankLine of model.bank) {
      y = text(page, bankLine, { x: MARGIN, y: y - 1, size: 8.5, color: muted, maxWidth: 420 });
    }
    y -= 6;
  }

  if (model.footer) {
    ensureSpace(24);
    text(page, model.footer, { x: MARGIN, y, size: 8, color: muted, maxWidth: CONTENT_WIDTH });
  }

  const pages = pdf.getPages();
  pages.forEach((current, index) => {
    current.drawText(`Page ${index + 1} / ${pages.length}`, {
      x: CONTENT_RIGHT - 60,
      y: 28,
      size: 8,
      font,
      color: muted,
    });
    current.drawText(sanitize(model.companyName), {
      x: MARGIN,
      y: 28,
      size: 8,
      font,
      color: muted,
    });
  });

  return { bytes: await pdf.save(), fileName: model.attachmentName };
}

async function embedLogo(
  pdf: PDFDocument,
  logo: DocumentLogo | null,
): Promise<EmbeddedLogo | null> {
  if (!logo) {
    return null;
  }
  const image =
    logo.mime === "image/png"
      ? await pdf.embedPng(logo.data)
      : logo.mime === "image/jpeg"
        ? await pdf.embedJpg(logo.data)
        : null;
  if (!image) {
    return null;
  }
  const maxWidth = 96;
  const maxHeight = 48;
  const ratio = Math.min(maxWidth / image.width, maxHeight / image.height, 1);
  return { image, width: image.width * ratio, height: image.height * ratio };
}
