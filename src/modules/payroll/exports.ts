import { Workbook, type Cell, type Worksheet } from "exceljs";
import type { PayrollPayslipStatus } from "@/db/schema";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { PAYROLL_PAYSLIP_STATUS_LABELS } from "./constants";

const SHEET_NAME = "Bulletins";
const TITLE_COLOR = "FF1F4D3A";
const MUTED_COLOR = "FF6B7280";
const BORDER_COLOR = "FFD1D5DB";
const AMOUNT_FORMAT = "#,##0";

interface ColumnSpec {
  readonly label: string;
  readonly width: number;
  readonly amount?: boolean;
}

/** PAY-008 — la ligne de bulletin telle que l'export la lit : les montants arrivent déjà calculés. */
export interface PayrollPayslipExportRow {
  readonly employeeCode: string;
  readonly employeeName: string;
  readonly periodLabel: string;
  readonly baseSalaryXof: number;
  readonly grossXof: number;
  readonly socialEmployeeXof: number;
  readonly socialEmployerXof: number;
  readonly deductionsXof: number;
  readonly netXof: number;
  readonly status: PayrollPayslipStatus;
  readonly validatedAt: Date | null;
}

const COLUMNS: readonly ColumnSpec[] = [
  { label: "Matricule", width: 14 },
  { label: "Salarié", width: 30 },
  { label: "Période", width: 16 },
  { label: "Salaire de base", width: 16, amount: true },
  { label: "Brut", width: 16, amount: true },
  { label: "Cotisation salariale", width: 18, amount: true },
  { label: "Cotisation patronale", width: 18, amount: true },
  { label: "Retenues", width: 14, amount: true },
  { label: "Net", width: 16, amount: true },
  { label: "Statut", width: 12 },
  { label: "Validé le", width: 12 },
];

function slug(value: string): string {
  const folded = value.normalize("NFD").replace(/\p{Diacritic}/gu, "");
  return (
    folded
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "bulletins"
  );
}

/** PAY-008 — le nom du classeur : le libellé de la période filtrée, ou « tous ». */
export function payrollPayslipsExportFileName(periodLabel: string | null): string {
  return `bulletins-paie-${slug(periodLabel ?? "tous")}.xlsx`;
}

function writeAmount(cell: Cell, value: number): void {
  cell.value = value;
  cell.numFmt = AMOUNT_FORMAT;
}

function writeTitle(sheet: Worksheet, periodLabel: string | null): void {
  const titleCell = sheet.getRow(1).getCell(1);
  titleCell.value = "Bulletins de paie";
  titleCell.font = { bold: true, size: 14, color: { argb: TITLE_COLOR } };
  sheet.mergeCells(1, 1, 1, COLUMNS.length);
  sheet.getRow(1).height = 22;

  const subtitleCell = sheet.getRow(2).getCell(1);
  subtitleCell.value =
    periodLabel === null
      ? "Toutes les périodes · montants en XOF"
      : `Période : ${periodLabel} · montants en XOF`;
  subtitleCell.font = { size: 10, color: { argb: MUTED_COLOR } };
  sheet.mergeCells(2, 1, 2, COLUMNS.length);
}

function writeHeader(sheet: Worksheet): void {
  const row = sheet.getRow(4);
  COLUMNS.forEach((column, index) => {
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
  sheet.views = [{ state: "frozen", ySplit: 4 }];
}

/** PAY-008 — l'export à plat du registre filtré, sans écriture ni autre effet. */
export async function buildPayrollPayslipsExport(
  rows: readonly PayrollPayslipExportRow[],
  periodLabel: string | null,
): Promise<Uint8Array<ArrayBuffer>> {
  const workbook = new Workbook();
  workbook.creator = "Lean";
  workbook.title = "Bulletins de paie";

  const sheet = workbook.addWorksheet(SHEET_NAME);
  writeTitle(sheet, periodLabel);
  writeHeader(sheet);

  let cursor = 5;
  for (const row of rows) {
    const line = sheet.getRow(cursor);
    line.getCell(1).value = row.employeeCode;
    line.getCell(2).value = row.employeeName;
    line.getCell(3).value = row.periodLabel;
    writeAmount(line.getCell(4), row.baseSalaryXof);
    writeAmount(line.getCell(5), row.grossXof);
    writeAmount(line.getCell(6), row.socialEmployeeXof);
    writeAmount(line.getCell(7), row.socialEmployerXof);
    writeAmount(line.getCell(8), row.deductionsXof);
    writeAmount(line.getCell(9), row.netXof);
    line.getCell(10).value = PAYROLL_PAYSLIP_STATUS_LABELS[row.status];
    line.getCell(11).value = row.validatedAt ? isoDateLabel(todayIsoDate(row.validatedAt)) : "";
    for (let column = 1; column <= COLUMNS.length; column += 1) {
      line.getCell(column).font = { size: 10 };
    }
    cursor += 1;
  }

  if (rows.length === 0) {
    const empty = sheet.getCell(5, 1);
    empty.value = "Aucun bulletin sur ce périmètre.";
    empty.font = { italic: true, size: 10, color: { argb: MUTED_COLOR } };
    cursor = 6;
  } else {
    const totalRow = sheet.getRow(cursor);
    totalRow.getCell(1).value = `Total (${rows.length})`;
    writeAmount(
      totalRow.getCell(9),
      rows.reduce((total, row) => total + row.netXof, 0),
    );
    for (let column = 1; column <= COLUMNS.length; column += 1) {
      const cell = totalRow.getCell(column);
      cell.font = { bold: true };
      cell.border = { top: { style: "thin", color: { argb: BORDER_COLOR } } };
    }
  }

  const written = await workbook.xlsx.writeBuffer();
  const source = new Uint8Array(written as ArrayBuffer);
  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  return bytes;
}
