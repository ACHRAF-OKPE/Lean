import { Workbook, type Cell, type Worksheet } from "exceljs";
import { isoDateLabel } from "@/lib/dates";
import {
  AGING_BUCKETS,
  AGING_BUCKET_LABELS,
  INCOME_STATEMENT_SECTIONS,
  REPORT_SHEET_NAMES,
} from "./constants";
import type {
  AgedReceivablesReport,
  IncomeStatementReport,
  SupplierCommitmentsReport,
} from "./queries";
import { summarizeByCustomer } from "./calculation";

const TITLE_COLOR = "FF1F4D3A";
const MUTED_COLOR = "FF6B7280";
const SECTION_FILL = "FFEDF2EF";
const BORDER_COLOR = "FFD1D5DB";
const AMOUNT_FORMAT = "#,##0";

interface ColumnSpec {
  readonly label: string;
  readonly width: number;
  readonly amount?: boolean;
}

function newWorkbook(): Workbook {
  const workbook = new Workbook();
  workbook.creator = "Lean";
  workbook.lastModifiedBy = "Lean";
  workbook.created = new Date();
  workbook.modified = new Date();
  return workbook;
}

async function serialize(workbook: Workbook): Promise<Uint8Array<ArrayBuffer>> {
  const written = await workbook.xlsx.writeBuffer();
  const source = new Uint8Array(written as ArrayBuffer);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}

function writeTitle(sheet: Worksheet, title: string, subtitle: string, columnCount: number): void {
  const titleCell = sheet.getRow(1).getCell(1);
  titleCell.value = title;
  titleCell.font = { bold: true, size: 14, color: { argb: TITLE_COLOR } };
  sheet.mergeCells(1, 1, 1, columnCount);
  sheet.getRow(1).height = 22;

  const subtitleCell = sheet.getRow(2).getCell(1);
  subtitleCell.value = subtitle;
  subtitleCell.font = { size: 10, color: { argb: MUTED_COLOR } };
  sheet.mergeCells(2, 1, 2, columnCount);
}

function writeHeader(sheet: Worksheet, rowNumber: number, columns: readonly ColumnSpec[]): void {
  const row = sheet.getRow(rowNumber);
  columns.forEach((column, index) => {
    const cell = row.getCell(index + 1);
    cell.value = column.label;
    cell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TITLE_COLOR } };
    cell.alignment = { vertical: "middle" };
    sheet.getColumn(index + 1).width = column.width;
    if (column.amount) {
      sheet.getColumn(index + 1).numFmt = AMOUNT_FORMAT;
    }
  });
  row.height = 22;
  sheet.views = [{ state: "frozen", ySplit: rowNumber }];
}

function writeSection(
  sheet: Worksheet,
  rowNumber: number,
  label: string,
  columnCount: number,
): void {
  const row = sheet.getRow(rowNumber);
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: SECTION_FILL } };
    cell.font = { bold: true, size: 10, color: { argb: TITLE_COLOR } };
  }
  row.getCell(1).value = label;
  sheet.mergeCells(rowNumber, 1, rowNumber, columnCount);
  row.height = 18;
}

function writeAmount(cell: Cell, value: number): void {
  cell.value = value;
  cell.numFmt = AMOUNT_FORMAT;
}

function writeTotalRow(
  sheet: Worksheet,
  rowNumber: number,
  label: string,
  values: readonly { readonly column: number; readonly value: number }[],
  columnCount: number,
): void {
  const row = sheet.getRow(rowNumber);
  row.getCell(1).value = label;
  for (const item of values) {
    writeAmount(row.getCell(item.column), item.value);
  }
  for (let column = 1; column <= columnCount; column += 1) {
    const cell = row.getCell(column);
    cell.font = { bold: true };
    cell.border = { top: { style: "thin", color: { argb: BORDER_COLOR } } };
  }
}

function slug(value: string): string {
  const folded = value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return (
    folded
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "rapport"
  );
}

export function incomeStatementFileName(report: IncomeStatementReport): string {
  return `compte-resultat-${slug(report.fiscalYear.label)}.xlsx`;
}

export function agedReceivablesFileName(report: AgedReceivablesReport): string {
  return `balance-agee-creances-${report.referenceDate}.xlsx`;
}

export function supplierCommitmentsFileName(report: SupplierCommitmentsReport): string {
  return `engagements-fournisseurs-${report.referenceDate}.xlsx`;
}

export async function buildIncomeStatementWorkbook(
  report: IncomeStatementReport,
): Promise<Uint8Array<ArrayBuffer>> {
  const columns: ColumnSpec[] = [
    { label: "Compte", width: 14 },
    { label: "Libellé", width: 48 },
    { label: "Débit", width: 16, amount: true },
    { label: "Crédit", width: 16, amount: true },
    { label: "Charges", width: 16, amount: true },
    { label: "Produits", width: 16, amount: true },
  ];

  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet(REPORT_SHEET_NAMES.resultat);
  writeTitle(
    sheet,
    `Compte de résultat — ${report.fiscalYear.label}`,
    `Exercice du ${isoDateLabel(report.fiscalYear.startsOn)} au ${isoDateLabel(report.fiscalYear.endsOn)} — montants en XOF`,
    columns.length,
  );
  writeHeader(sheet, 4, columns);
  let cursor = 5;

  for (const section of INCOME_STATEMENT_SECTIONS) {
    const rows = report.rows.filter((row) => row.accountClass === section.accountClass);
    if (rows.length === 0) {
      continue;
    }
    writeSection(sheet, cursor, section.label, columns.length);
    cursor += 1;
    for (const row of rows) {
      const line = sheet.getRow(cursor);
      line.getCell(1).value = row.code;
      line.getCell(2).value = row.label;
      writeAmount(line.getCell(3), row.debit);
      writeAmount(line.getCell(4), row.credit);
      if (row.chargeXof !== 0) {
        writeAmount(line.getCell(5), row.chargeXof);
      }
      if (row.produitXof !== 0) {
        writeAmount(line.getCell(6), row.produitXof);
      }
      cursor += 1;
    }
  }

  if (report.rows.length === 0) {
    sheet.getCell(5, 1).value =
      "Aucune charge ni produit comptabilisé sur cet exercice : le résultat est vide.";
    sheet.getCell(5, 1).font = { italic: true, size: 10, color: { argb: MUTED_COLOR } };
    cursor = 6;
  }

  const totalsStart = cursor + 1;
  writeTotalRow(
    sheet,
    totalsStart,
    "Total charges",
    [{ column: 5, value: report.charges }],
    columns.length,
  );
  writeTotalRow(
    sheet,
    totalsStart + 1,
    "Total produits",
    [{ column: 6, value: report.produits }],
    columns.length,
  );
  const resultRow = totalsStart + 2;
  const resultLabel =
    report.result > 0
      ? "Résultat net : bénéfice"
      : report.result < 0
        ? "Résultat net : perte"
        : "Résultat net : à l'équilibre";
  writeTotalRow(
    sheet,
    resultRow,
    resultLabel,
    [
      report.result >= 0
        ? { column: 6, value: report.result }
        : { column: 5, value: -report.result },
    ],
    columns.length,
  );

  const control = sheet.getRow(resultRow + 2);
  control.getCell(1).value = "Contrôle bilan";
  control.getCell(2).value =
    "Total des soldes des classes 1 à 5 — doit égaler l'opposé du résultat net de l'exercice";
  control.getCell(1).font = { size: 10 };
  control.getCell(2).font = { italic: true, size: 10, color: { argb: MUTED_COLOR } };
  writeAmount(control.getCell(3), report.balanceSheetBalance);

  return serialize(workbook);
}

export async function buildAgedReceivablesWorkbook(
  report: AgedReceivablesReport,
): Promise<Uint8Array<ArrayBuffer>> {
  const columns: ColumnSpec[] = [
    { label: "Code client", width: 14 },
    { label: "Client", width: 32 },
    { label: "Facture", width: 18 },
    { label: "Date", width: 12 },
    { label: "Échéance", width: 12 },
    { label: "Total", width: 15, amount: true },
    { label: "Payé", width: 15, amount: true },
    { label: "Solde", width: 15, amount: true },
    { label: "Retard (j)", width: 11 },
    { label: "Ancienneté", width: 18 },
  ];

  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet(REPORT_SHEET_NAMES.creances);
  writeTitle(
    sheet,
    "Balance âgée des créances clients",
    `Situation au ${isoDateLabel(report.referenceDate)} — factures validées non soldées, montants en XOF`,
    columns.length,
  );
  writeHeader(sheet, 4, columns);
  let cursor = 5;

  for (const row of report.rows) {
    const line = sheet.getRow(cursor);
    line.getCell(1).value = row.customerCode;
    line.getCell(2).value = row.customerName;
    line.getCell(3).value = row.number ?? "—";
    line.getCell(4).value = isoDateLabel(row.invoiceDate);
    line.getCell(5).value = isoDateLabel(row.dueDate);
    writeAmount(line.getCell(6), row.totalXof);
    writeAmount(line.getCell(7), row.paidXof);
    writeAmount(line.getCell(8), row.balanceXof);
    line.getCell(9).value = row.overdueDays;
    line.getCell(10).value = AGING_BUCKET_LABELS[row.bucket];
    cursor += 1;
  }

  if (report.rows.length === 0) {
    sheet.getCell(5, 1).value = "Aucune créance client ouverte à cette date.";
    sheet.getCell(5, 1).font = { italic: true, size: 10, color: { argb: MUTED_COLOR } };
    cursor = 6;
  } else {
    writeTotalRow(sheet, cursor, "Total", [{ column: 8, value: report.totalXof }], columns.length);
  }

  cursor += 2;
  writeSection(sheet, cursor, "Synthèse par ancienneté", columns.length);
  cursor += 1;
  for (const bucket of AGING_BUCKETS) {
    const line = sheet.getRow(cursor);
    line.getCell(2).value = AGING_BUCKET_LABELS[bucket];
    writeAmount(line.getCell(8), report.totals[bucket]);
    cursor += 1;
  }
  writeTotalRow(
    sheet,
    cursor,
    "Dont échu",
    [{ column: 8, value: report.overdueXof }],
    columns.length,
  );

  cursor += 2;
  writeSection(sheet, cursor, "Synthèse par client", columns.length);
  cursor += 1;
  const customerHeader = sheet.getRow(cursor);
  customerHeader.getCell(1).value = "Code client";
  customerHeader.getCell(2).value = "Client";
  AGING_BUCKETS.forEach((bucket, index) => {
    customerHeader.getCell(3 + index).value = AGING_BUCKET_LABELS[bucket];
  });
  customerHeader.getCell(8).value = "Total";
  customerHeader.getCell(9).value = "Factures";
  for (let column = 1; column <= columns.length; column += 1) {
    customerHeader.getCell(column).font = { bold: true, size: 10, color: { argb: MUTED_COLOR } };
  }
  cursor += 1;

  const customers = summarizeByCustomer(report.rows);
  if (customers.length === 0) {
    sheet.getCell(cursor, 1).value = "Aucun client créancier à cette date.";
    sheet.getCell(cursor, 1).font = { italic: true, size: 10, color: { argb: MUTED_COLOR } };
    cursor += 1;
  }
  for (const customer of customers) {
    const line = sheet.getRow(cursor);
    line.getCell(1).value = customer.customerCode;
    line.getCell(2).value = customer.customerName;
    AGING_BUCKETS.forEach((bucket, index) => {
      const amount = customer.totals[bucket];
      if (amount > 0) {
        writeAmount(line.getCell(3 + index), amount);
      }
    });
    writeAmount(line.getCell(8), customer.totalXof);
    line.getCell(9).value = customer.invoiceCount;
    cursor += 1;
  }
  writeTotalRow(
    sheet,
    cursor,
    "Total",
    [
      ...AGING_BUCKETS.map((bucket, index) => ({
        column: 3 + index,
        value: report.totals[bucket],
      })),
      { column: 8, value: report.totalXof },
    ],
    columns.length,
  );

  return serialize(workbook);
}

export async function buildSupplierCommitmentsWorkbook(
  report: SupplierCommitmentsReport,
): Promise<Uint8Array<ArrayBuffer>> {
  const columns: ColumnSpec[] = [
    { label: "Code fournisseur", width: 16 },
    { label: "Fournisseur", width: 32 },
    { label: "Commande", width: 18 },
    { label: "Date", width: 12 },
    { label: "Réception prévue", width: 16 },
    { label: "Lignes", width: 10 },
    { label: "Montant", width: 16, amount: true },
    { label: "Statut", width: 12 },
  ];

  const workbook = newWorkbook();
  const sheet = workbook.addWorksheet(REPORT_SHEET_NAMES.engagements);
  writeTitle(
    sheet,
    "Engagements fournisseurs",
    `Situation au ${isoDateLabel(report.referenceDate)} — commandes confirmées non entièrement reçues, montants en XOF`,
    columns.length,
  );
  writeHeader(sheet, 4, columns);
  let cursor = 5;

  for (const row of report.rows) {
    const line = sheet.getRow(cursor);
    line.getCell(1).value = row.supplierCode;
    line.getCell(2).value = row.supplierName;
    line.getCell(3).value = row.number ?? "—";
    line.getCell(4).value = isoDateLabel(row.orderDate);
    line.getCell(5).value = row.expectedReceiptDate ? isoDateLabel(row.expectedReceiptDate) : "—";
    line.getCell(6).value = row.lineCount;
    writeAmount(line.getCell(7), row.amountXof);
    line.getCell(8).value = row.overdue ? "En retard" : "À venir";
    cursor += 1;
  }

  if (report.rows.length === 0) {
    sheet.getCell(5, 1).value = "Aucun engagement fournisseur ouvert à cette date.";
    sheet.getCell(5, 1).font = { italic: true, size: 10, color: { argb: MUTED_COLOR } };
    cursor = 6;
  } else {
    writeTotalRow(sheet, cursor, "Total", [{ column: 7, value: report.totalXof }], columns.length);
  }

  cursor += 2;
  writeSection(sheet, cursor, "Synthèse", columns.length);
  cursor += 1;
  const overdue = sheet.getRow(cursor);
  overdue.getCell(2).value = "Dont en retard de réception";
  writeAmount(overdue.getCell(7), report.overdueXof);

  return serialize(workbook);
}
