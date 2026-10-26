import type { ExchangeType } from "@/db/schema";
import { isoDateLabel } from "@/lib/dates";
import { formatXof } from "@/lib/money";
import { formatQuantity } from "@/modules/stock/quantities";

export interface DocumentCompanySnapshot {
  readonly legalName: string;
  readonly legalForm: string | null;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly postalCode: string | null;
  readonly countryCode: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly taxId: string | null;
  readonly rccm: string | null;
  readonly paymentTermDays: number;
  readonly defaultIncoterm: string | null;
  readonly invoiceFooter: string | null;
  readonly bankName: string | null;
  readonly bankAccountHolder: string | null;
  readonly bankAccountNumber: string | null;
  readonly bankSwift: string | null;
}

export interface DocumentSupplierSnapshot {
  readonly name: string;
  readonly code: string;
  readonly addressLine: string | null;
  readonly city: string | null;
  readonly countryCode: string | null;
  readonly email: string | null;
  readonly phone: string | null;
}

export interface DocumentOrderSnapshot {
  readonly number: string | null;
  readonly orderDate: string;
  readonly expectedReceiptDate: string | null;
  readonly externalReference: string | null;
  readonly notes: string | null;
  readonly exTaxTotal: number;
}

export interface DocumentLineSnapshot {
  readonly lineNumber: number;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
}

export interface PurchaseDocumentInput {
  readonly type: ExchangeType;
  readonly company: DocumentCompanySnapshot;
  readonly supplier: DocumentSupplierSnapshot;
  readonly order: DocumentOrderSnapshot;
  readonly lines: readonly DocumentLineSnapshot[];
}

export interface DocumentMeta {
  readonly label: string;
  readonly value: string;
}

export interface PurchaseDocumentLine {
  readonly index: number;
  readonly name: string;
  readonly quantity: string;
  readonly unit: string;
  readonly unitPrice: string;
  readonly total: string;
}

export interface PurchaseDocumentModel {
  readonly title: string;
  readonly reference: string;
  readonly companyName: string;
  readonly companyDetails: readonly string[];
  readonly supplierName: string;
  readonly supplierDetails: readonly string[];
  readonly meta: readonly DocumentMeta[];
  readonly lines: readonly PurchaseDocumentLine[];
  readonly totalLabel: string;
  readonly conditions: readonly string[];
  readonly bank: readonly string[];
  readonly footer: string | null;
  readonly attachmentName: string;
}

const countryNames = new Intl.DisplayNames(["fr"], { type: "region" });

export function countryLabel(code: string | null): string | null {
  if (!code) {
    return null;
  }
  try {
    return countryNames.of(code) ?? code;
  } catch {
    return code;
  }
}

function addressLine(
  street: string | null,
  postalCode: string | null,
  city: string | null,
  countryCode: string | null,
): string | null {
  const locality = [postalCode, city].filter(Boolean).join(" ");
  const parts = [street, locality, countryLabel(countryCode)].filter((part): part is string =>
    Boolean(part),
  );
  return parts.length > 0 ? parts.join(" · ") : null;
}

function compact(values: readonly (string | null)[]): readonly string[] {
  return values.filter((value): value is string => Boolean(value));
}

export function paymentTermsLabel(days: number): string {
  return days > 0 ? `${days} jours` : "comptant";
}

export function buildPurchaseDocument(input: PurchaseDocumentInput): PurchaseDocumentModel {
  const { company, supplier, order, lines, type } = input;
  const isRequest = type === "purchase_request";
  const reference = order.number ?? "Sans numéro";

  const companyDetails = compact([
    company.legalForm,
    addressLine(company.addressLine, company.postalCode, company.city, company.countryCode),
    company.taxId ? `N° fiscal : ${company.taxId}` : null,
    company.rccm ? `RCCM : ${company.rccm}` : null,
    company.phone ? `Tél. : ${company.phone}` : null,
    company.email,
  ]);

  const supplierDetails = compact([
    supplier.code ? `Code : ${supplier.code}` : null,
    addressLine(supplier.addressLine, null, supplier.city, supplier.countryCode),
    supplier.phone ? `Tél. : ${supplier.phone}` : null,
    supplier.email,
  ]);

  const meta: DocumentMeta[] = [
    { label: "Référence", value: reference },
    { label: "Date", value: isoDateLabel(order.orderDate) },
    {
      label: "Réception prévue",
      value: order.expectedReceiptDate ? isoDateLabel(order.expectedReceiptDate) : "—",
    },
    { label: "Référence externe", value: order.externalReference ?? "—" },
  ];

  const conditions = compact([
    `Conditions de règlement : ${paymentTermsLabel(company.paymentTermDays)}.`,
    company.defaultIncoterm ? `Incoterm : ${company.defaultIncoterm}.` : null,
    order.notes ? `Notes : ${order.notes}` : null,
  ]);

  const bank = compact([
    company.bankName,
    company.bankAccountHolder ? `Titulaire : ${company.bankAccountHolder}` : null,
    company.bankAccountNumber ? `Compte : ${company.bankAccountNumber}` : null,
    company.bankSwift ? `SWIFT/BIC : ${company.bankSwift}` : null,
  ]);

  return {
    title: isRequest ? "Demande de prix" : "Bon de commande",
    reference,
    companyName: company.legalName,
    companyDetails,
    supplierName: supplier.name,
    supplierDetails,
    meta,
    lines: lines.map((line) => ({
      index: line.lineNumber,
      name: line.name,
      quantity: formatQuantity(line.qty),
      unit: line.unitCode,
      unitPrice: formatXof(line.unitPriceXof),
      total: formatXof(line.lineTotalXof),
    })),
    totalLabel: formatXof(order.exTaxTotal),
    conditions,
    bank,
    footer: company.invoiceFooter,
    attachmentName: attachmentName(isRequest, order.number),
  };
}

function attachmentName(isRequest: boolean, number: string | null): string {
  const safe = number ? number.toLowerCase() : "sans-numero";
  return `${isRequest ? "demande-de-prix" : "bon-de-commande"}-${safe}.pdf`;
}
