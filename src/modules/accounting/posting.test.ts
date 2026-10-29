import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, asc, count, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  accountingJournals,
  accountingSettings,
  auditEvents,
  fiscalYears,
  invoices,
  journalEntries,
  journalEntryLineLetterings,
  journalEntryLines,
  ledgerAccounts,
} from "@/db/schema";
import { createTestDatabase, type TestDatabase } from "@/test/pglite";
import { seedSalesTenant, type SalesTenant } from "@/test/sales";
import { enableAccounting, seedAccountingTenant, type AccountingRefs } from "@/test/accounting";
import { todayIsoDate } from "@/lib/dates";
import { createDelivery } from "@/modules/sales/deliveries";
import { createInvoice, validateInvoice } from "@/modules/sales/invoices";
import { createInvoicePayment } from "@/modules/sales/payments";
import { createSalesOrder, getSalesOrder, transitionSalesOrder } from "@/modules/sales/queries";
import {
  createPurchaseOrder,
  getPurchaseOrder,
  transitionPurchaseOrder,
} from "@/modules/purchases/queries";
import { cancelReception, createReception } from "@/modules/stock/receptions";
import { closeFiscalYear, createJournalEntry, validateJournalEntry } from "./queries";
import { getCutoffReport } from "./cutoff";
import { AccountingError } from "./errors";
import {
  getLetteringCandidates,
  getLetteringGroups,
  letterLines,
  unletterGroup,
} from "./lettering";
import { postCutoffDocuments } from "./posting";
import { getAccountingSettingsView, saveAccountingSettings } from "./settings";

let context: TestDatabase;
let db: Database;

beforeAll(async () => {
  context = await createTestDatabase();
  db = context.db;
});

afterAll(async () => {
  await context.close();
});

const TODAY = todayIsoDate();

async function opsTenant(label: string): Promise<{ ids: SalesTenant; refs: AccountingRefs }> {
  const ids = await seedSalesTenant(db, label);
  const refs = await enableAccounting(db, { tenantId: ids.tenantId, userId: ids.userId });
  return { ids, refs };
}

async function confirmedOrder(
  ids: SalesTenant,
  lines: readonly { articleId: string; qty: string; unitPriceXof: number }[],
): Promise<{ orderId: string; lineIds: readonly string[] }> {
  const created = await createSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: {
      customerId: ids.customerId,
      expectedDeliveryDate: "",
      externalReference: "",
      incoterm: "",
      notes: "",
      lines,
    },
  });
  await transitionSalesOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId: created.id,
    action: "confirm",
  });
  const detail = await getSalesOrder(db, { tenantId: ids.tenantId, orderId: created.id });
  if (!detail) {
    throw new Error("Commande de vente introuvable.");
  }
  return { orderId: created.id, lineIds: detail.lines.map((line) => line.id) };
}

async function deliverAll(
  ids: SalesTenant,
  orderId: string,
  orderLineId: string,
  qty: string,
): Promise<void> {
  await createDelivery(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    locationId: ids.locationId,
    deliveredDate: TODAY,
    notes: null,
    lines: [{ orderLineId, qty }],
  });
}

async function freshInvoice(
  ids: SalesTenant,
  qty = "5",
  unitPriceXof = 1500,
): Promise<{ invoiceId: string; number: string; total: number }> {
  const order = await confirmedOrder(ids, [{ articleId: ids.productId, qty, unitPriceXof }]);
  const lineId = order.lineIds[0];
  if (!lineId) {
    throw new Error("Ligne de commande absente.");
  }
  await deliverAll(ids, order.orderId, lineId, qty);
  const draft = await createInvoice(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId: order.orderId,
    invoiceDate: TODAY,
    dueDate: TODAY,
    notes: null,
    lines: [{ orderLineId: lineId, qty }],
  });
  const validated = await validateInvoice(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    invoiceId: draft.invoiceId,
  });
  return { invoiceId: draft.invoiceId, number: validated.number, total: draft.exTaxTotal };
}

async function confirmedPurchaseOrder(ids: SalesTenant): Promise<{
  orderId: string;
  lineIds: readonly string[];
}> {
  const created = await createPurchaseOrder(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    data: {
      supplierId: ids.supplierId,
      expectedReceiptDate: "",
      externalReference: "",
      notes: "",
      lines: [
        { articleId: ids.productId, qty: "3", unitPriceXof: 1000 },
        { articleId: ids.secondProductId, qty: "2", unitPriceXof: 450 },
      ],
    },
  });
  for (const action of ["request", "confirm"] as const) {
    await transitionPurchaseOrder(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: created.id,
      action,
    });
  }
  const detail = await getPurchaseOrder(db, { tenantId: ids.tenantId, orderId: created.id });
  if (!detail) {
    throw new Error("Commande d'achat introuvable.");
  }
  return { orderId: created.id, lineIds: detail.lines.map((line) => line.id) };
}

async function receiveAll(
  ids: SalesTenant,
  orderId: string,
  lineIds: readonly string[],
): Promise<{ receptionId: string; number: string }> {
  const first = lineIds[0];
  const second = lineIds[1];
  if (!first || !second) {
    throw new Error("Lignes d'achat absentes.");
  }
  return createReception(db, {
    tenantId: ids.tenantId,
    actorUserId: ids.userId,
    orderId,
    locationId: ids.locationId,
    receivedDate: TODAY,
    notes: null,
    lines: [
      { orderLineId: first, qty: "3" },
      { orderLineId: second, qty: "2" },
    ],
  });
}

async function entriesOf(tenantId: string) {
  return db
    .select()
    .from(journalEntries)
    .where(eq(journalEntries.tenantId, tenantId))
    .orderBy(asc(journalEntries.number));
}

async function linesOf(entryId: string) {
  return db
    .select({
      id: journalEntryLines.id,
      accountId: journalEntryLines.accountId,
      code: ledgerAccounts.code,
      partnerId: journalEntryLines.partnerId,
      debit: journalEntryLines.debit,
      credit: journalEntryLines.credit,
    })
    .from(journalEntryLines)
    .innerJoin(
      ledgerAccounts,
      and(
        eq(ledgerAccounts.tenantId, journalEntryLines.tenantId),
        eq(ledgerAccounts.id, journalEntryLines.accountId),
      ),
    )
    .where(eq(journalEntryLines.entryId, entryId))
    .orderBy(asc(journalEntryLines.lineNumber));
}

function settingsRaw(ids: AccountingRefs) {
  return {
    salesJournalId: ids.saleJournalId,
    purchaseJournalId: ids.purchaseJournalId,
    bankJournalId: ids.bankJournalId,
    customerAccountId: ids.clientAccountId,
    supplierAccountId: ids.supplierAccountId,
    salesAccountId: ids.salesAccountId,
    purchaseAccountId: ids.purchaseAccountId,
    bankAccountId: ids.bankAccountId,
  };
}

describe("ACC-011 — paramétrage comptable", () => {
  it("refuse un journal inactif, un mauvais type, une mauvaise classe et un compte étranger", async () => {
    const seed = await seedAccountingTenant(db, "acc-011");
    const other = await seedAccountingTenant(db, "acc-011-voisin");

    await expect(
      saveAccountingSettings(db, {
        tenantId: seed.tenantId,
        actorUserId: seed.userId,
        raw: { ...settingsRaw(seed), salesJournalId: seed.inactiveJournalId },
      }),
    ).rejects.toBeInstanceOf(AccountingError);

    await expect(
      saveAccountingSettings(db, {
        tenantId: seed.tenantId,
        actorUserId: seed.userId,
        raw: { ...settingsRaw(seed), salesJournalId: seed.bankJournalId },
      }),
    ).rejects.toThrow(/type vente/);

    await expect(
      saveAccountingSettings(db, {
        tenantId: seed.tenantId,
        actorUserId: seed.userId,
        raw: { ...settingsRaw(seed), customerAccountId: seed.salesAccountId },
      }),
    ).rejects.toThrow(/classe 4/);

    await expect(
      saveAccountingSettings(db, {
        tenantId: seed.tenantId,
        actorUserId: seed.userId,
        raw: { ...settingsRaw(seed), supplierAccountId: other.supplierAccountId },
      }),
    ).rejects.toThrow(/introuvable/);

    const first = await saveAccountingSettings(db, {
      tenantId: seed.tenantId,
      actorUserId: seed.userId,
      raw: settingsRaw(seed),
    });
    expect(first.created).toBe(true);
    const second = await saveAccountingSettings(db, {
      tenantId: seed.tenantId,
      actorUserId: seed.userId,
      raw: settingsRaw(seed),
    });
    expect(second.created).toBe(false);

    const view = await getAccountingSettingsView(db, seed.tenantId);
    expect(view?.salesJournalCode).toBe("VE");
    expect(view?.purchaseJournalCode).toBe("AC");
    expect(view?.bankJournalCode).toBe("BQ");
    expect(view?.customerAccountCode).toBe("411000");
    expect(view?.supplierAccountCode).toBe("401000");
    expect(view?.salesAccountCode).toBe("701000");
    expect(view?.purchaseAccountCode).toBe("601000");
    expect(view?.bankAccountCode).toBe("521000");

    const [settingsCount] = await db
      .select({ value: count() })
      .from(accountingSettings)
      .where(eq(accountingSettings.tenantId, seed.tenantId));
    expect(settingsCount?.value).toBe(1);

    const actions = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, seed.tenantId),
          eq(auditEvents.entityType, "accounting_settings"),
        ),
      );
    expect(actions.map((row) => row.action).sort()).toEqual([
      "accounting.settings.update",
      "accounting.settings.update",
    ]);
  });
});

describe("ACC-012 — validation de facture", () => {
  it("comptabilise une écriture VE validée, équilibrée et idempotente", async () => {
    const { ids } = await opsTenant("acc-012");
    const invoice = await freshInvoice(ids);

    const entries = await entriesOf(ids.tenantId);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry) {
      throw new Error("Écriture absente.");
    }
    expect(entry.source).toBe("sale_invoice");
    expect(entry.sourceId).toBe(invoice.invoiceId);
    expect(entry.status).toBe("validated");
    expect(entry.number).toMatch(/^VE-\d{4}-\d{4}$/);
    expect(entry.reference).toBe(invoice.number);
    expect(entry.entryDate).toBe(TODAY);
    expect(entry.totalDebit).toBe(invoice.total);
    expect(entry.totalCredit).toBe(invoice.total);

    const lines = await linesOf(entry.id);
    expect(lines.map((line) => line.code).sort()).toEqual(["411000", "701000"]);
    const customer = lines.find((line) => line.code === "411000");
    expect(customer?.debit).toBe(invoice.total);
    expect(customer?.credit).toBe(0);
    expect(customer?.partnerId).toBe(ids.customerId);
    const sales = lines.find((line) => line.code === "701000");
    expect(sales?.credit).toBe(invoice.total);
    expect(sales?.debit).toBe(0);

    await expect(
      validateInvoice(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: invoice.invoiceId,
      }),
    ).rejects.toThrow(/brouillon/);
    expect(await entriesOf(ids.tenantId)).toHaveLength(1);
  });

  it("ne comptabilise rien sans paramétrage", async () => {
    const ids = await seedSalesTenant(db, "acc-012-sans-param");
    await freshInvoice(ids);
    expect(await entriesOf(ids.tenantId)).toHaveLength(0);
  });

  it("refuse la validation quand aucun exercice ouvert ne couvre la date", async () => {
    const ids = await seedSalesTenant(db, "acc-012-annee");
    const accountRows = await db
      .insert(ledgerAccounts)
      .values([
        { tenantId: ids.tenantId, code: "411000", label: "Clients", accountClass: 4 },
        { tenantId: ids.tenantId, code: "401000", label: "Fournisseurs", accountClass: 4 },
        { tenantId: ids.tenantId, code: "521000", label: "Banque", accountClass: 5 },
        { tenantId: ids.tenantId, code: "601000", label: "Achats", accountClass: 6 },
        { tenantId: ids.tenantId, code: "701000", label: "Ventes", accountClass: 7 },
      ])
      .returning({ id: ledgerAccounts.id, code: ledgerAccounts.code });
    const accountByCode = new Map(accountRows.map((row) => [row.code, row.id]));
    const journalRows = await db
      .insert(accountingJournals)
      .values([
        { tenantId: ids.tenantId, code: "VE", label: "Ventes", type: "sale" as const },
        { tenantId: ids.tenantId, code: "AC", label: "Achats", type: "purchase" as const },
        { tenantId: ids.tenantId, code: "BQ", label: "Banque", type: "bank" as const },
      ])
      .returning({ id: accountingJournals.id, code: accountingJournals.code });
    const journalByCode = new Map(journalRows.map((row) => [row.code, row.id]));
    await saveAccountingSettings(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: {
        salesJournalId: journalByCode.get("VE"),
        purchaseJournalId: journalByCode.get("AC"),
        bankJournalId: journalByCode.get("BQ"),
        customerAccountId: accountByCode.get("411000"),
        supplierAccountId: accountByCode.get("401000"),
        salesAccountId: accountByCode.get("701000"),
        purchaseAccountId: accountByCode.get("601000"),
        bankAccountId: accountByCode.get("521000"),
      },
    });

    const order = await confirmedOrder(ids, [
      { articleId: ids.productId, qty: "2", unitPriceXof: 1500 },
    ]);
    const lineId = order.lineIds[0];
    if (!lineId) {
      throw new Error("Ligne absente.");
    }
    await deliverAll(ids, order.orderId, lineId, "2");
    const draft = await createInvoice(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      orderId: order.orderId,
      invoiceDate: TODAY,
      dueDate: TODAY,
      notes: null,
      lines: [{ orderLineId: lineId, qty: "2" }],
    });

    await expect(
      validateInvoice(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        invoiceId: draft.invoiceId,
      }),
    ).rejects.toThrow(/Aucun exercice ouvert/);

    const [row] = await db.select().from(invoices).where(eq(invoices.id, draft.invoiceId));
    expect(row?.status).toBe("draft");
    expect(await entriesOf(ids.tenantId)).toHaveLength(0);
  });
});

describe("ACC-013 — règlement client", () => {
  it("comptabilise un règlement en banque avec le tiers client", async () => {
    const { ids } = await opsTenant("acc-013");
    const invoice = await freshInvoice(ids);

    const withReference = await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
      amountXof: 5000,
      paidDate: TODAY,
      method: "transfer",
      reference: "VIR-2026-001",
    });
    const withoutReference = await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
      amountXof: invoice.total - 5000,
      paidDate: TODAY,
      method: "mobile_money",
      reference: "",
    });

    const entries = await entriesOf(ids.tenantId);
    expect(entries).toHaveLength(3);
    const paymentEntry = entries.find((entry) => entry.sourceId === withReference.id);
    const invoiceNumberEntry = entries.find((entry) => entry.sourceId === withoutReference.id);
    if (!paymentEntry || !invoiceNumberEntry) {
      throw new Error("Écritures de règlement absentes.");
    }
    expect(paymentEntry.source).toBe("sale_payment");
    expect(paymentEntry.status).toBe("validated");
    expect(paymentEntry.number).toMatch(/^BQ-\d{4}-\d{4}$/);
    expect(paymentEntry.reference).toBe("VIR-2026-001");
    expect(invoiceNumberEntry.reference).toBe(invoice.number);

    const lines = await linesOf(paymentEntry.id);
    const bank = lines.find((line) => line.code === "521000");
    expect(bank?.debit).toBe(5000);
    expect(bank?.credit).toBe(0);
    const customer = lines.find((line) => line.code === "411000");
    expect(customer?.credit).toBe(5000);
    expect(customer?.partnerId).toBe(ids.customerId);
  });
});

describe("ACC-014 — réception et annulation", () => {
  it("comptabilise la réception au coût HT et l'annulation en contrepassation", async () => {
    const { ids } = await opsTenant("acc-014");
    const order = await confirmedPurchaseOrder(ids);
    const reception = await receiveAll(ids, order.orderId, order.lineIds);

    let entries = await entriesOf(ids.tenantId);
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    if (!entry) {
      throw new Error("Écriture de réception absente.");
    }
    expect(entry.source).toBe("purchase_reception");
    expect(entry.sourceId).toBe(reception.receptionId);
    expect(entry.number).toMatch(/^AC-\d{4}-\d{4}$/);
    expect(entry.totalDebit).toBe(3900);
    const lines = await linesOf(entry.id);
    const purchase = lines.find((line) => line.code === "601000");
    expect(purchase?.debit).toBe(3900);
    const supplier = lines.find((line) => line.code === "401000");
    expect(supplier?.credit).toBe(3900);
    expect(supplier?.partnerId).toBe(ids.supplierId);

    await cancelReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      receptionId: reception.receptionId,
      notes: null,
    });

    entries = await entriesOf(ids.tenantId);
    expect(entries).toHaveLength(2);
    const reversalEntry = entries.find((row) => row.source === "purchase_reception_cancel");
    if (!reversalEntry) {
      throw new Error("Écriture d'annulation absente.");
    }
    expect(reversalEntry.sourceId).toBe(reception.receptionId);
    const reversalLines = await linesOf(reversalEntry.id);
    const supplierDebit = reversalLines.find((line) => line.code === "401000");
    expect(supplierDebit?.debit).toBe(3900);
    const purchaseCredit = reversalLines.find((line) => line.code === "601000");
    expect(purchaseCredit?.credit).toBe(3900);
  });

  it("n'annule pas une réception jamais comptabilisée", async () => {
    const ids = await seedSalesTenant(db, "acc-014-sans-param");
    const order = await confirmedPurchaseOrder(ids);
    const reception = await receiveAll(ids, order.orderId, order.lineIds);
    await enableAccounting(db, { tenantId: ids.tenantId, userId: ids.userId });
    await cancelReception(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      receptionId: reception.receptionId,
      notes: null,
    });
    expect(await entriesOf(ids.tenantId)).toHaveLength(0);
  });
});

describe("ACC-015 — lettrage", () => {
  it("lettre un compte de tiers équilibré, refuse les cas invalides et délettre le groupe", async () => {
    const { ids } = await opsTenant("acc-015");
    const invoice = await freshInvoice(ids);
    await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
      amountXof: 5000,
      paidDate: TODAY,
      method: "transfer",
      reference: "VIR-A",
    });
    await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
      amountXof: invoice.total - 5000,
      paidDate: TODAY,
      method: "cash",
      reference: "",
    });

    const candidates = await getLetteringCandidates(db, ids.tenantId);
    expect(candidates).toHaveLength(3);
    const debitLine = candidates.find((line) => line.debit > 0);
    const creditLines = candidates.filter((line) => line.credit > 0);
    const firstCredit = creditLines[0];
    if (!debitLine || !firstCredit || creditLines.length !== 2) {
      throw new Error("Candidats de lettrage inattendus.");
    }

    await expect(
      letterLines(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        lineIds: [debitLine.lineId, firstCredit.lineId],
      }),
    ).rejects.toThrow(/déséquilibré/);

    await expect(
      letterLines(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        lineIds: [debitLine.lineId],
      }),
    ).rejects.toThrow(/au moins deux lignes/);

    const result = await letterLines(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      lineIds: [debitLine.lineId, ...creditLines.map((line) => line.lineId)],
    });
    expect(result).toEqual({ code: "L0001", lineCount: 3, amountXof: invoice.total });

    const letteredRows = await db
      .select({ value: count() })
      .from(journalEntryLineLetterings)
      .where(eq(journalEntryLineLetterings.tenantId, ids.tenantId));
    expect(letteredRows[0]?.value).toBe(3);

    await expect(
      letterLines(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        lineIds: [debitLine.lineId, firstCredit.lineId],
      }),
    ).rejects.toThrow(/déjà lettrée/);

    expect(await getLetteringCandidates(db, ids.tenantId)).toHaveLength(0);

    const groups = await getLetteringGroups(db, ids.tenantId);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.code).toBe("L0001");
    expect(groups[0]?.lineCount).toBe(3);
    expect(groups[0]?.totalDebit).toBe(invoice.total);
    expect(groups[0]?.totalCredit).toBe(invoice.total);
    expect(groups[0]?.accountCode).toBe("411000");

    await unletterGroup(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      code: "L0001",
    });
    expect(await getLetteringGroups(db, ids.tenantId)).toHaveLength(0);
    expect(await getLetteringCandidates(db, ids.tenantId)).toHaveLength(3);

    const relettered = await letterLines(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      lineIds: [debitLine.lineId, ...creditLines.map((line) => line.lineId)],
    });
    expect(relettered.code).toBe("L0002");

    const actions = await db
      .select({ action: auditEvents.action })
      .from(auditEvents)
      .where(
        and(
          eq(auditEvents.tenantId, ids.tenantId),
          eq(auditEvents.entityType, "journal_entry_line_lettering"),
        ),
      )
      .orderBy(asc(auditEvents.createdAt));
    expect(actions.map((row) => row.action)).toEqual([
      "accounting.lettering.create",
      "accounting.lettering.remove",
      "accounting.lettering.create",
    ]);
  });

  it("refuse deux tiers différents ou un compte hors classe 4", async () => {
    const { ids, refs } = await opsTenant("acc-015-gardes");
    await freshInvoice(ids);
    const candidates = await getLetteringCandidates(db, ids.tenantId);
    const debitLine = candidates.find((line) => line.debit > 0);
    if (!debitLine) {
      throw new Error("Ligne de débit absente.");
    }

    const raw = (debitAccount: string, creditAccount: string, partner: string) => ({
      journalId: refs.saleJournalId,
      entryDate: TODAY,
      reference: "",
      label: "Écriture de test",
      lines: [
        { accountId: debitAccount, partnerId: partner, label: "Débit", debit: "7500", credit: "" },
        {
          accountId: creditAccount,
          partnerId: "",
          label: "Crédit",
          debit: "",
          credit: "7500",
        },
      ],
    });

    const foreign = await createJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: raw(refs.clientAccountId, refs.salesAccountId, ids.supplierId),
    });
    await validateJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: foreign.id,
    });
    const foreignLine = (await linesOf(foreign.id)).find((line) => line.debit > 0);

    await expect(
      letterLines(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        lineIds: [debitLine.lineId, foreignLine?.id ?? ""],
      }),
    ).rejects.toThrow(/un seul tiers/);

    const offClass = await createJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      raw: raw(refs.salesAccountId, refs.salesAccountId, ""),
    });
    await validateJournalEntry(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      entryId: offClass.id,
    });
    const offClassLines = await db
      .select({ id: journalEntryLines.id })
      .from(journalEntryLines)
      .where(eq(journalEntryLines.entryId, offClass.id))
      .orderBy(asc(journalEntryLines.lineNumber));
    const firstLine = offClassLines[0];
    const secondLine = offClassLines[1];
    if (!firstLine || !secondLine) {
      throw new Error("Lignes de test absentes.");
    }

    await expect(
      letterLines(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        lineIds: [firstLine.id, secondLine.id],
      }),
    ).rejects.toThrow(/classe 4/);
  });
});

describe("ACC-016 — cut-off", () => {
  it("rapporte les documents non comptabilisés, bloque la clôture puis rattrape", async () => {
    const ids = await seedSalesTenant(db, "acc-016");
    const invoice = await freshInvoice(ids);
    await createInvoicePayment(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      invoiceId: invoice.invoiceId,
      amountXof: 2000,
      paidDate: TODAY,
      method: "transfer",
      reference: "VIR-CUTOFF",
    });
    const purchase = await confirmedPurchaseOrder(ids);
    await receiveAll(ids, purchase.orderId, purchase.lineIds);

    expect(await entriesOf(ids.tenantId)).toHaveLength(0);

    const refs = await enableAccounting(db, { tenantId: ids.tenantId, userId: ids.userId });
    const report = await getCutoffReport(db, {
      tenantId: ids.tenantId,
      fiscalYearId: refs.fiscalYear2026Id,
    });
    expect(report.configured).toBe(true);
    expect(report.postedCount).toBe(0);
    expect(report.unpostedCount).toBe(3);
    expect(report.documents.map((document) => document.kind)).toEqual([
      "purchase_reception",
      "sale_invoice",
      "sale_payment",
    ]);
    expect(report.unpostedAmountXof).toBe(invoice.total + 2000 + 3900);

    await expect(
      closeFiscalYear(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        fiscalYearId: refs.fiscalYear2026Id,
      }),
    ).rejects.toThrow(/Clôture refusée/);

    const catchUp = await postCutoffDocuments(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      fiscalYearId: refs.fiscalYear2026Id,
    });
    expect(catchUp).toEqual({ posted: 3, alreadyPosted: 0 });

    const after = await getCutoffReport(db, {
      tenantId: ids.tenantId,
      fiscalYearId: refs.fiscalYear2026Id,
    });
    expect(after.postedCount).toBe(3);
    expect(after.unpostedCount).toBe(0);

    const again = await postCutoffDocuments(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      fiscalYearId: refs.fiscalYear2026Id,
    });
    expect(again).toEqual({ posted: 0, alreadyPosted: 3 });
    expect(await entriesOf(ids.tenantId)).toHaveLength(3);

    await closeFiscalYear(db, {
      tenantId: ids.tenantId,
      actorUserId: ids.userId,
      fiscalYearId: refs.fiscalYear2026Id,
    });
    const [closed] = await db
      .select({ status: fiscalYears.status })
      .from(fiscalYears)
      .where(eq(fiscalYears.id, refs.fiscalYear2026Id));
    expect(closed?.status).toBe("closed");

    await expect(
      postCutoffDocuments(db, {
        tenantId: ids.tenantId,
        actorUserId: ids.userId,
        fiscalYearId: refs.fiscalYear2026Id,
      }),
    ).rejects.toThrow(/clôturé/);
  });
});
