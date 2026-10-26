import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { formatXof } from "@/lib/money";
import { buildPurchaseDocument, countryLabel, paymentTermsLabel } from "./document-model";
import { renderPurchaseDocumentPdf } from "./document";

const COMPANY = {
  legalName: "Lean SARL",
  legalForm: "SARL",
  addressLine: "Boulevard Valéry Giscard d'Estaing",
  city: "Abidjan",
  postalCode: "00225",
  countryCode: "CI",
  email: "contact@lean.test",
  phone: "+225 27 20 00 00 00",
  taxId: "CI-1234567 A",
  rccm: "CI-ABJ-2026-B-00001",
  paymentTermDays: 30,
  defaultIncoterm: "FOB",
  invoiceFooter: "Règlement par virement uniquement.",
  bankName: "Banque Atlantique",
  bankAccountHolder: "Lean SARL",
  bankAccountNumber: "CI001234567890123456789",
  bankSwift: "ATCIABID",
};

const SUPPLIER = {
  name: "Sahel Négoce SARL",
  code: "FOUR001",
  addressLine: "Zone industrielle de Yopougon",
  city: "Abidjan",
  countryCode: "CI",
  email: "contact@sahel.test",
  phone: "+225 27 21 00 00 00",
};

const ORDER = {
  number: "CMD-2026-0001",
  orderDate: "2026-10-26",
  expectedReceiptDate: "2026-11-05",
  externalReference: "REF-FOUR-001",
  notes: "Livraison avant midi.",
  exTaxTotal: 125000,
};

const LINES = [
  {
    lineNumber: 1,
    name: "Café vert Arabica",
    unitCode: "KG",
    qty: "2.000000",
    unitPriceXof: 1000,
    lineTotalXof: 2000,
  },
  {
    lineNumber: 2,
    name: "Transport maritime",
    unitCode: "FOR",
    qty: "1.000000",
    unitPriceXof: 123000,
    lineTotalXof: 123000,
  },
];

describe("ORG-009 — instantané du document émis", () => {
  it("ORG-009 reprend l'identité, le règlement, l'incoterm et la banque", () => {
    const document = buildPurchaseDocument({
      type: "purchase_confirmation",
      company: COMPANY,
      supplier: SUPPLIER,
      order: ORDER,
      lines: LINES,
    });

    expect(document.title).toBe("Bon de commande");
    expect(document.companyName).toBe("Lean SARL");
    expect(document.companyDetails.join(" ")).toContain("N° fiscal : CI-1234567 A");
    expect(document.companyDetails.join(" ")).toContain("RCCM : CI-ABJ-2026-B-00001");
    expect(document.companyDetails.join(" ")).toMatch(/Côte d.Ivoire/);
    expect(document.supplierName).toBe("Sahel Négoce SARL");
    expect(document.conditions.join(" ")).toContain("Conditions de règlement : 30 jours.");
    expect(document.conditions.join(" ")).toContain("Incoterm : FOB.");
    expect(document.bank.join(" ")).toContain("Banque Atlantique");
    expect(document.footer).toBe("Règlement par virement uniquement.");
    expect(document.totalLabel).toBe(formatXof(125000));
    expect(document.attachmentName).toBe("bon-de-commande-cmd-2026-0001.pdf");
  });

  it("ORG-009 omet les valeurs absentes au lieu d'un espace réservé", () => {
    const document = buildPurchaseDocument({
      type: "purchase_request",
      company: {
        ...COMPANY,
        legalForm: null,
        addressLine: null,
        postalCode: null,
        city: null,
        countryCode: null,
        email: null,
        phone: null,
        taxId: null,
        rccm: null,
        defaultIncoterm: null,
        invoiceFooter: null,
        bankName: null,
        bankAccountHolder: null,
        bankAccountNumber: null,
        bankSwift: null,
      },
      supplier: {
        ...SUPPLIER,
        addressLine: null,
        city: null,
        countryCode: null,
        email: null,
        phone: null,
      },
      order: {
        ...ORDER,
        number: null,
        expectedReceiptDate: null,
        externalReference: null,
        notes: null,
      },
      lines: LINES,
    });

    expect(document.companyDetails).toEqual([]);
    expect(document.supplierDetails).toEqual(["Code : FOUR001"]);
    expect(document.bank).toEqual([]);
    expect(document.conditions).toEqual(["Conditions de règlement : 30 jours."]);
    expect(document.footer).toBeNull();
    expect(document.attachmentName).toBe("demande-de-prix-sans-numero.pdf");
    expect(document.companyDetails.join(" ")).not.toMatch(/null|undefined/);
  });

  it("ORG-009 fige l'instantané : modifier la fiche ensuite ne change pas le document", () => {
    const company = { ...COMPANY };
    const document = buildPurchaseDocument({
      type: "purchase_request",
      company,
      supplier: SUPPLIER,
      order: ORDER,
      lines: LINES,
    });
    company.legalName = "Autre raison sociale";
    company.addressLine = "Nouvelle adresse";
    expect(document.companyName).toBe("Lean SARL");
    expect(document.companyDetails.join(" ")).toContain("Boulevard Valéry Giscard d'Estaing");
  });

  it("ORG-009 formate le règlement et les pays en français", () => {
    expect(paymentTermsLabel(0)).toBe("comptant");
    expect(paymentTermsLabel(45)).toBe("45 jours");
    expect(countryLabel("CI")).toMatch(/Côte d.Ivoire/);
    expect(countryLabel(null)).toBeNull();
  });
});

const ONE_PIXEL_PNG = Uint8Array.from(
  Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  ),
);

describe("ORG-008 — pièce jointe PDF", () => {
  it("ORG-008 produit un PDF valide avec les accents français", async () => {
    const document = buildPurchaseDocument({
      type: "purchase_confirmation",
      company: COMPANY,
      supplier: SUPPLIER,
      order: ORDER,
      lines: LINES,
    });
    const pdf = await renderPurchaseDocumentPdf(document, null);

    expect(pdf.fileName).toBe(document.attachmentName);
    expect(new TextDecoder().decode(pdf.bytes.slice(0, 5))).toBe("%PDF-");
    const loaded = await PDFDocument.load(pdf.bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });

  it("ORG-008 joint un logo embarqué sans altérer le PDF", async () => {
    const document = buildPurchaseDocument({
      type: "purchase_request",
      company: COMPANY,
      supplier: SUPPLIER,
      order: ORDER,
      lines: LINES,
    });
    const pdf = await renderPurchaseDocumentPdf(document, {
      mime: "image/png",
      data: ONE_PIXEL_PNG,
    });
    expect(pdf.bytes.byteLength).toBeGreaterThan(1000);
    const loaded = await PDFDocument.load(pdf.bytes);
    expect(loaded.getPageCount()).toBeGreaterThanOrEqual(1);
  });
});
