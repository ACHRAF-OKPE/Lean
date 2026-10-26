import { variableSample } from "./variables";

export type TemplateValues = Readonly<Record<string, string>>;

export interface RenderedLines {
  readonly text: string;
  readonly html: string;
}

export interface RenderedExchange {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface RenderableLine {
  readonly lineNumber: number;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly unitPriceLabel: string;
  readonly totalLabel: string;
}

const TOKEN_PATTERN = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const ESCAPES: Readonly<Record<string, string>> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

function replaceValues(text: string, values: TemplateValues, html: boolean): string {
  return text.replace(TOKEN_PATTERN, (_match, token: string) => {
    const value = values[token] ?? "";
    return html ? escapeHtml(value) : value;
  });
}

export function renderTemplateSubject(subject: string, values: TemplateValues): string {
  return replaceValues(subject, values, false).trim();
}

export function renderExchangeLines(lines: readonly RenderableLine[]): RenderedLines {
  const text = lines
    .map(
      (line) =>
        `${line.lineNumber}. ${line.name} — ${line.qty} ${line.unitCode} × ${line.unitPriceLabel} = ${line.totalLabel}`,
    )
    .join("\n");

  const rows = lines
    .map(
      (line) =>
        `<tr>` +
        `<td style="padding:4px 6px;border-bottom:1px solid #e5e5e5;color:#666">${line.lineNumber}</td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid #e5e5e5">${escapeHtml(line.name)}</td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid #e5e5e5;text-align:right">${escapeHtml(line.qty)}</td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid #e5e5e5">${escapeHtml(line.unitCode)}</td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid #e5e5e5;text-align:right">${escapeHtml(line.unitPriceLabel)}</td>` +
        `<td style="padding:4px 6px;border-bottom:1px solid #e5e5e5;text-align:right">${escapeHtml(line.totalLabel)}</td>` +
        `</tr>`,
    )
    .join("");

  const html =
    `<table style="width:100%;border-collapse:collapse;font-size:13px;margin:12px 0">` +
    `<thead><tr>` +
    `<th style="padding:4px 6px;text-align:left;border-bottom:2px solid #111">N°</th>` +
    `<th style="padding:4px 6px;text-align:left;border-bottom:2px solid #111">Désignation</th>` +
    `<th style="padding:4px 6px;text-align:right;border-bottom:2px solid #111">Qté</th>` +
    `<th style="padding:4px 6px;text-align:left;border-bottom:2px solid #111">Unité</th>` +
    `<th style="padding:4px 6px;text-align:right;border-bottom:2px solid #111">Prix unitaire</th>` +
    `<th style="padding:4px 6px;text-align:right;border-bottom:2px solid #111">Total</th>` +
    `</tr></thead><tbody>${rows}</tbody></table>`;

  return { text, html };
}

export function renderExchangeTemplate(
  subject: string,
  body: string,
  values: TemplateValues,
  lines: RenderedLines,
): RenderedExchange {
  const renderedSubject = renderTemplateSubject(subject, values);
  const text = body.replace(TOKEN_PATTERN, (_match, token: string) =>
    token === "order.lines" ? lines.text : (values[token] ?? ""),
  );
  const escaped = escapeHtml(body);
  const htmlBody = escaped
    .replace(/\{\{\s*order\.lines\s*\}\}/g, lines.html)
    .replace(TOKEN_PATTERN, (_match, token: string) => escapeHtml(values[token] ?? ""));
  const html =
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">` +
    `<div style="white-space:pre-wrap">${htmlBody}</div>` +
    `</div>`;
  return { subject: renderedSubject, text, html };
}

export function sampleTemplateValues(): TemplateValues {
  const values: Record<string, string> = {};
  for (const variable of TEMPLATE_VARIABLES_FOR_SAMPLE) {
    values[variable] = variableSample(variable);
  }
  return values;
}

const TEMPLATE_VARIABLES_FOR_SAMPLE = [
  "company.legal_name",
  "company.legal_form",
  "company.address",
  "company.city",
  "company.country",
  "company.email",
  "company.phone",
  "company.tax_id",
  "company.rccm",
  "company.payment_terms",
  "company.incoterm",
  "company.bank_name",
  "company.bank_account",
  "company.bank_swift",
  "company.footer",
  "supplier.name",
  "supplier.code",
  "supplier.contact",
  "supplier.email",
  "supplier.address",
  "supplier.city",
  "supplier.country",
  "order.number",
  "order.date",
  "order.expected_date",
  "order.external_reference",
  "order.notes",
  "order.total",
  "order.line_count",
  "document.link",
  "sender.name",
] as const;
