import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  articles,
  auditEvents,
  partners,
  purchaseOrderLines,
  purchaseOrders,
  tenderAwards,
  tenderInvitations,
  tenderQuoteLines,
  tenderQuotes,
  tenderRequestLines,
  tenderRequests,
  type TenderInvitationStatus,
  type TenderQuoteLineRow,
  type TenderQuoteRow,
  type TenderRequestLineRow,
  type TenderRequestRow,
  type TenderStatus,
} from "@/db/schema";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { getEmailAccountConfig } from "@/modules/exchange/queries";
import {
  defaultTransportFactory,
  type MailAccountConfig,
  type TransportFactory,
} from "@/modules/exchange/mailer";
import { computeOrderReceiptState } from "@/modules/purchases/lifecycle";
import { getCompanySettings } from "@/modules/settings/queries";
import { isZeroQuantity, computeLineTotal } from "@/modules/stock/quantities";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import {
  bestOffer,
  isTenderFullyResolved,
  offersByLine,
  validateTenderAward,
  type TenderOffer,
} from "./awards";
import { TenderError } from "./errors";
import {
  buildQuoteLink,
  createTenderToken,
  renderTenderEmail,
  tenderTokenExpiry,
  validateTenderDraft,
  type DraftTenderInput,
} from "./rules";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isEmail(value: string | null | undefined): value is string {
  return Boolean(value && value.length <= 160 && EMAIL_PATTERN.test(value));
}

function mailError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export interface TenderSupplierOption {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly email: string | null;
}

export interface TenderLineDetail {
  readonly id: string;
  readonly lineNumber: number;
  readonly articleId: string;
  readonly articleCode: string;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly requestedDate: string | null;
  readonly note: string | null;
  readonly rejected: boolean;
}

export interface TenderQuoteLineDetail {
  readonly id: string;
  readonly tenderLineId: string;
  readonly proposedQty: string;
  readonly unitPriceXof: number;
  readonly lineTotalXof: number;
}

export interface TenderQuoteDetail {
  readonly id: string;
  readonly invitationId: string;
  readonly revision: number;
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly leadTimeDays: number | null;
  readonly comment: string | null;
  readonly declined: boolean;
  readonly totalXof: number;
  readonly submittedAt: Date;
  readonly lines: readonly TenderQuoteLineDetail[];
}

export interface TenderInvitationDetail {
  readonly id: string;
  readonly supplierId: string;
  readonly supplierCode: string;
  readonly supplierName: string;
  readonly recipientEmail: string;
  readonly recipientName: string | null;
  readonly status: TenderInvitationStatus;
  readonly sentAt: Date | null;
  readonly firstViewedAt: Date | null;
  readonly lastQuotedAt: Date | null;
  readonly errorMessage: string | null;
  readonly quoteCount: number;
  readonly latestQuote: TenderQuoteDetail | null;
}

export interface TenderAwardDetail {
  readonly id: string;
  readonly tenderLineId: string;
  readonly supplierId: string;
  readonly supplierName: string;
  readonly quoteId: string;
  readonly qty: string;
  readonly unitPriceXof: number;
  readonly motive: string | null;
  readonly awardedAt: Date;
}

export interface TenderDetail {
  readonly tender: {
    readonly id: string;
    readonly number: string | null;
    readonly title: string;
    readonly notes: string | null;
    readonly deadline: string;
    readonly status: TenderStatus;
    readonly sentAt: Date | null;
    readonly awardedAt: Date | null;
    readonly ordersCreatedAt: Date | null;
    readonly cancelReason: string | null;
    readonly cancelledAt: Date | null;
    readonly createdAt: Date;
    readonly updatedAt: Date;
  };
  readonly lines: readonly TenderLineDetail[];
  readonly invitations: readonly TenderInvitationDetail[];
  readonly awards: readonly TenderAwardDetail[];
  readonly purchaseOrders: readonly { readonly id: string; readonly supplierName: string }[];
}

export interface TenderSummary {
  readonly id: string;
  readonly number: string | null;
  readonly title: string;
  readonly deadline: string;
  readonly status: TenderStatus;
  readonly lineCount: number;
  readonly supplierCount: number;
  readonly quotedCount: number;
  readonly awardedCount: number;
  readonly createdAt: Date;
}

export interface LatestQuoteBundle {
  readonly quotes: readonly TenderQuoteDetail[];
  readonly offers: readonly TenderOffer[];
  readonly quoteCountByInvitation: ReadonlyMap<string, number>;
}

export async function getTenderSupplierOptions(
  db: Database,
  tenantId: string,
): Promise<readonly TenderSupplierOption[]> {
  return db
    .select({ id: partners.id, code: partners.code, name: partners.name, email: partners.email })
    .from(partners)
    .where(
      and(
        eq(partners.tenantId, tenantId),
        eq(partners.isSupplier, true),
        eq(partners.active, true),
      ),
    )
    .orderBy(asc(partners.name))
    .limit(500);
}

export async function listTenders(db: Database, tenantId: string): Promise<TenderSummary[]> {
  const rows = await db
    .select({
      id: tenderRequests.id,
      number: tenderRequests.number,
      title: tenderRequests.title,
      deadline: tenderRequests.deadline,
      status: tenderRequests.status,
      createdAt: tenderRequests.createdAt,
    })
    .from(tenderRequests)
    .where(eq(tenderRequests.tenantId, tenantId))
    .orderBy(desc(tenderRequests.createdAt))
    .limit(200);

  if (rows.length === 0) {
    return [];
  }
  const ids = rows.map((row) => row.id);

  const [lineRows, invitationRows, quoteRows, awardRows] = await Promise.all([
    db
      .select({ tenderId: tenderRequestLines.tenderId })
      .from(tenderRequestLines)
      .where(
        and(eq(tenderRequestLines.tenantId, tenantId), inArray(tenderRequestLines.tenderId, ids)),
      ),
    db
      .select({ tenderId: tenderInvitations.tenderId })
      .from(tenderInvitations)
      .where(
        and(eq(tenderInvitations.tenantId, tenantId), inArray(tenderInvitations.tenderId, ids)),
      ),
    db
      .select({ tenderId: tenderQuotes.tenderId, invitationId: tenderQuotes.invitationId })
      .from(tenderQuotes)
      .where(and(eq(tenderQuotes.tenantId, tenantId), inArray(tenderQuotes.tenderId, ids))),
    db
      .select({ tenderId: tenderAwards.tenderId })
      .from(tenderAwards)
      .where(and(eq(tenderAwards.tenantId, tenantId), inArray(tenderAwards.tenderId, ids))),
  ]);

  const countBy = (key: "tenderId", list: readonly { tenderId: string }[]) => {
    const map = new Map<string, number>();
    for (const item of list) {
      map.set(item[key], (map.get(item[key]) ?? 0) + 1);
    }
    return map;
  };
  const lineCount = countBy("tenderId", lineRows);
  const supplierCount = countBy("tenderId", invitationRows);
  const awardCount = countBy("tenderId", awardRows);
  const quotedByTender = new Map<string, Set<string>>();
  for (const quote of quoteRows) {
    const set = quotedByTender.get(quote.tenderId) ?? new Set<string>();
    set.add(quote.invitationId);
    quotedByTender.set(quote.tenderId, set);
  }

  return rows.map((row) => ({
    ...row,
    lineCount: lineCount.get(row.id) ?? 0,
    supplierCount: supplierCount.get(row.id) ?? 0,
    quotedCount: quotedByTender.get(row.id)?.size ?? 0,
    awardedCount: awardCount.get(row.id) ?? 0,
  }));
}

async function loadLatestQuotes(
  db: Database,
  tenantId: string,
  tenderId: string,
): Promise<{
  latestQuotes: TenderQuoteRow[];
  linesByQuote: Map<string, TenderQuoteLineRow[]>;
  quoteCountByInvitation: Map<string, number>;
  invitations: Map<string, { supplierId: string; supplierName: string; supplierCode: string }>;
}> {
  const invitationRows = await db
    .select({
      id: tenderInvitations.id,
      supplierId: tenderInvitations.supplierId,
      supplierName: partners.name,
      supplierCode: partners.code,
    })
    .from(tenderInvitations)
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, tenderInvitations.tenantId),
        eq(partners.id, tenderInvitations.supplierId),
      ),
    )
    .where(and(eq(tenderInvitations.tenantId, tenantId), eq(tenderInvitations.tenderId, tenderId)));

  const invitationMap = new Map(
    invitationRows.map((row) => [
      row.id,
      {
        supplierId: row.supplierId,
        supplierName: row.supplierName,
        supplierCode: row.supplierCode,
      },
    ]),
  );

  const quoteRows = await db
    .select()
    .from(tenderQuotes)
    .where(and(eq(tenderQuotes.tenantId, tenantId), eq(tenderQuotes.tenderId, tenderId)))
    .orderBy(desc(tenderQuotes.revision));

  const latestByInvitation = new Map<string, TenderQuoteRow>();
  const quoteCountByInvitation = new Map<string, number>();
  for (const quote of quoteRows) {
    quoteCountByInvitation.set(
      quote.invitationId,
      (quoteCountByInvitation.get(quote.invitationId) ?? 0) + 1,
    );
    if (!latestByInvitation.has(quote.invitationId)) {
      latestByInvitation.set(quote.invitationId, quote);
    }
  }
  const latestQuotes = [...latestByInvitation.values()];

  const quoteLines =
    latestQuotes.length === 0
      ? []
      : await db
          .select()
          .from(tenderQuoteLines)
          .where(
            and(
              eq(tenderQuoteLines.tenantId, tenantId),
              inArray(
                tenderQuoteLines.quoteId,
                latestQuotes.map((quote) => quote.id),
              ),
            ),
          );
  const linesByQuote = new Map<string, TenderQuoteLineRow[]>();
  for (const line of quoteLines) {
    const list = linesByQuote.get(line.quoteId);
    if (list) {
      list.push(line);
    } else {
      linesByQuote.set(line.quoteId, [line]);
    }
  }

  return { latestQuotes, linesByQuote, quoteCountByInvitation, invitations: invitationMap };
}

function toQuoteDetail(
  quote: TenderQuoteRow,
  lines: readonly TenderQuoteLineRow[],
): TenderQuoteDetail {
  return {
    id: quote.id,
    invitationId: quote.invitationId,
    revision: quote.revision,
    authorName: quote.authorName,
    authorEmail: quote.authorEmail,
    leadTimeDays: quote.leadTimeDays,
    comment: quote.comment,
    declined: quote.declined,
    totalXof: quote.totalXof,
    submittedAt: quote.submittedAt,
    lines: lines.map((line) => ({
      id: line.id,
      tenderLineId: line.tenderLineId,
      proposedQty: line.proposedQty,
      unitPriceXof: line.unitPriceXof,
      lineTotalXof: line.lineTotalXof,
    })),
  };
}

async function loadLatestQuoteBundle(
  db: Database,
  tenantId: string,
  tenderId: string,
): Promise<LatestQuoteBundle> {
  const { latestQuotes, linesByQuote, quoteCountByInvitation, invitations } =
    await loadLatestQuotes(db, tenantId, tenderId);
  const quotes = latestQuotes.map((quote) =>
    toQuoteDetail(quote, linesByQuote.get(quote.id) ?? []),
  );
  const offers: TenderOffer[] = [];
  for (const quote of quotes) {
    if (quote.declined) {
      continue;
    }
    const supplier = invitations.get(quote.invitationId);
    if (!supplier) {
      continue;
    }
    for (const line of quote.lines) {
      offers.push({
        tenderLineId: line.tenderLineId,
        quoteId: quote.id,
        quoteLineId: line.id,
        supplierId: supplier.supplierId,
        supplierName: supplier.supplierName,
        revision: quote.revision,
        proposedQty: line.proposedQty,
        unitPriceXof: line.unitPriceXof,
        lineTotalXof: line.lineTotalXof,
        leadTimeDays: quote.leadTimeDays,
        submittedAt: quote.submittedAt,
      });
    }
  }
  return { quotes, offers, quoteCountByInvitation };
}

export async function getTender(
  db: Database,
  input: { tenantId: string; tenderId: string },
): Promise<TenderDetail | null> {
  const [tender] = await db
    .select()
    .from(tenderRequests)
    .where(and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)))
    .limit(1);
  if (!tender) {
    return null;
  }

  const [lineRows, invitationRows, awardRows, purchaseRows, bundle] = await Promise.all([
    db
      .select({
        id: tenderRequestLines.id,
        lineNumber: tenderRequestLines.lineNumber,
        articleId: tenderRequestLines.articleId,
        articleCode: articles.code,
        name: tenderRequestLines.name,
        unitCode: tenderRequestLines.unitCode,
        qty: tenderRequestLines.qty,
        requestedDate: tenderRequestLines.requestedDate,
        note: tenderRequestLines.note,
        rejected: tenderRequestLines.rejected,
      })
      .from(tenderRequestLines)
      .innerJoin(
        articles,
        and(
          eq(articles.tenantId, tenderRequestLines.tenantId),
          eq(articles.id, tenderRequestLines.articleId),
        ),
      )
      .where(
        and(
          eq(tenderRequestLines.tenantId, input.tenantId),
          eq(tenderRequestLines.tenderId, input.tenderId),
        ),
      )
      .orderBy(asc(tenderRequestLines.lineNumber)),
    db
      .select({
        id: tenderInvitations.id,
        supplierId: tenderInvitations.supplierId,
        supplierCode: partners.code,
        supplierName: partners.name,
        recipientEmail: tenderInvitations.recipientEmail,
        recipientName: tenderInvitations.recipientName,
        status: tenderInvitations.status,
        sentAt: tenderInvitations.sentAt,
        firstViewedAt: tenderInvitations.firstViewedAt,
        lastQuotedAt: tenderInvitations.lastQuotedAt,
        errorMessage: tenderInvitations.errorMessage,
      })
      .from(tenderInvitations)
      .innerJoin(
        partners,
        and(
          eq(partners.tenantId, tenderInvitations.tenantId),
          eq(partners.id, tenderInvitations.supplierId),
        ),
      )
      .where(
        and(
          eq(tenderInvitations.tenantId, input.tenantId),
          eq(tenderInvitations.tenderId, input.tenderId),
        ),
      )
      .orderBy(asc(partners.name)),
    db
      .select({
        id: tenderAwards.id,
        tenderLineId: tenderAwards.tenderLineId,
        supplierId: tenderAwards.supplierId,
        supplierName: partners.name,
        quoteId: tenderAwards.quoteId,
        qty: tenderAwards.qty,
        unitPriceXof: tenderAwards.unitPriceXof,
        motive: tenderAwards.motive,
        awardedAt: tenderAwards.awardedAt,
      })
      .from(tenderAwards)
      .innerJoin(
        partners,
        and(eq(partners.tenantId, tenderAwards.tenantId), eq(partners.id, tenderAwards.supplierId)),
      )
      .where(
        and(eq(tenderAwards.tenantId, input.tenantId), eq(tenderAwards.tenderId, input.tenderId)),
      )
      .orderBy(asc(tenderAwards.awardedAt)),
    db
      .select({ id: purchaseOrders.id, supplierName: partners.name })
      .from(purchaseOrders)
      .innerJoin(
        partners,
        and(
          eq(partners.tenantId, purchaseOrders.tenantId),
          eq(partners.id, purchaseOrders.supplierId),
        ),
      )
      .where(
        and(
          eq(purchaseOrders.tenantId, input.tenantId),
          eq(purchaseOrders.tenderId, input.tenderId),
        ),
      )
      .orderBy(asc(purchaseOrders.createdAt)),
    loadLatestQuoteBundle(db, input.tenantId, input.tenderId),
  ]);

  const quoteByInvitation = new Map(bundle.quotes.map((quote) => [quote.invitationId, quote]));

  return {
    tender: {
      id: tender.id,
      number: tender.number,
      title: tender.title,
      notes: tender.notes,
      deadline: tender.deadline,
      status: tender.status,
      sentAt: tender.sentAt,
      awardedAt: tender.awardedAt,
      ordersCreatedAt: tender.ordersCreatedAt,
      cancelReason: tender.cancelReason,
      cancelledAt: tender.cancelledAt,
      createdAt: tender.createdAt,
      updatedAt: tender.updatedAt,
    },
    lines: lineRows,
    invitations: invitationRows.map((row) => ({
      ...row,
      quoteCount: bundle.quoteCountByInvitation.get(row.id) ?? 0,
      latestQuote: quoteByInvitation.get(row.id) ?? null,
    })),
    awards: awardRows,
    purchaseOrders: purchaseRows,
  };
}

interface ResolvedDraft {
  readonly title: string;
  readonly deadline: string;
  readonly notes: string | null;
  readonly lines: readonly {
    readonly articleId: string;
    readonly name: string;
    readonly unitCode: string;
    readonly qty: string;
    readonly requestedDate: string | null;
    readonly note: string | null;
  }[];
  readonly suppliers: readonly {
    readonly supplierId: string;
    readonly name: string;
    readonly email: string;
  }[];
}

async function resolveDraft(
  db: Database,
  tenantId: string,
  data: DraftTenderInput,
): Promise<ResolvedDraft> {
  const validation = validateTenderDraft(data, todayIsoDate());
  if (!validation.draft) {
    throw new TenderError(validation.errors.join("\n"));
  }
  const draft = validation.draft;

  const articleIds = [...new Set(draft.lines.map((line) => line.articleId))];
  const articleRows = await db
    .select({
      id: articles.id,
      code: articles.code,
      name: articles.name,
      unitCode: articles.unitCode,
      active: articles.active,
      isPurchasable: articles.isPurchasable,
    })
    .from(articles)
    .where(and(eq(articles.tenantId, tenantId), inArray(articles.id, articleIds)));
  const articleById = new Map(articleRows.map((row) => [row.id, row]));

  const supplierIds = [...draft.supplierIds];
  const supplierRows = await db
    .select({
      id: partners.id,
      code: partners.code,
      name: partners.name,
      email: partners.email,
      active: partners.active,
      isSupplier: partners.isSupplier,
    })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), inArray(partners.id, supplierIds)));
  const supplierById = new Map(supplierRows.map((row) => [row.id, row]));

  const errors: string[] = [];
  const lines = draft.lines.map((line, index) => {
    const article = articleById.get(line.articleId);
    if (!article) {
      errors.push(`Ligne ${index + 1} : article introuvable dans cet espace.`);
      return null;
    }
    if (!article.active || !article.isPurchasable) {
      errors.push(`Ligne ${index + 1} : ${article.code} inactif ou non achetable.`);
      return null;
    }
    return {
      articleId: article.id,
      name: article.name,
      unitCode: article.unitCode,
      qty: line.qty,
      requestedDate: line.requestedDate,
      note: line.note,
    };
  });

  const suppliers = draft.supplierIds.map((supplierId, index) => {
    const supplier = supplierById.get(supplierId);
    if (!supplier) {
      errors.push(`Fournisseur ${index + 1} : introuvable dans cet espace.`);
      return null;
    }
    if (!supplier.active || !supplier.isSupplier) {
      errors.push(`Fournisseur ${index + 1} : ${supplier.code} inactif ou sans rôle fournisseur.`);
      return null;
    }
    if (!isEmail(supplier.email)) {
      errors.push(`Fournisseur ${index + 1} : ${supplier.code} sans adresse e-mail valide.`);
      return null;
    }
    return { supplierId: supplier.id, name: supplier.name, email: supplier.email };
  });

  if (errors.length > 0) {
    throw new TenderError(errors.join("\n"));
  }

  return {
    title: draft.title,
    deadline: draft.deadline,
    notes: draft.notes,
    lines: lines.filter((line): line is NonNullable<typeof line> => line !== null),
    suppliers: suppliers.filter(
      (supplier): supplier is NonNullable<typeof supplier> => supplier !== null,
    ),
  };
}

export interface CreateTenderResult {
  readonly id: string;
}

export async function createTenderDraft(
  db: Database,
  input: { tenantId: string; actorUserId: string; data: DraftTenderInput },
): Promise<CreateTenderResult> {
  const draft = await resolveDraft(db, input.tenantId, input.data);

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(tenderRequests)
      .values({
        tenantId: input.tenantId,
        title: draft.title,
        notes: draft.notes,
        deadline: draft.deadline,
        status: "draft",
        createdBy: input.actorUserId,
      })
      .returning({ id: tenderRequests.id });
    if (!created) {
      throw new TenderError("La demande de cotation n'a pas pu être créée.");
    }

    await tx.insert(tenderRequestLines).values(
      draft.lines.map((line, index) => ({
        tenantId: input.tenantId,
        tenderId: created.id,
        lineNumber: index + 1,
        articleId: line.articleId,
        name: line.name,
        unitCode: line.unitCode,
        qty: line.qty,
        requestedDate: line.requestedDate,
        note: line.note,
      })),
    );

    await tx.insert(tenderInvitations).values(
      draft.suppliers.map((supplier) => ({
        tenantId: input.tenantId,
        tenderId: created.id,
        supplierId: supplier.supplierId,
        recipientEmail: supplier.email,
        recipientName: supplier.name,
        status: "pending" as const,
      })),
    );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.create",
      entityType: "tender_request",
      entityId: created.id,
      details: {
        title: draft.title,
        deadline: draft.deadline,
        lineCount: draft.lines.length,
        supplierCount: draft.suppliers.length,
      },
    });

    return { id: created.id };
  });
}

export async function updateTenderDraft(
  db: Database,
  input: { tenantId: string; actorUserId: string; tenderId: string; data: DraftTenderInput },
): Promise<CreateTenderResult> {
  const [existing] = await db
    .select({ status: tenderRequests.status })
    .from(tenderRequests)
    .where(and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)))
    .limit(1);
  if (!existing) {
    throw new TenderError("Demande de cotation introuvable dans cet espace de travail.");
  }
  if (existing.status !== "draft") {
    throw new TenderError("Seul un brouillon peut être modifié.");
  }

  const draft = await resolveDraft(db, input.tenantId, input.data);

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: tenderRequests.status })
      .from(tenderRequests)
      .where(
        and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)),
      )
      .for("update");
    if (!locked || locked.status !== "draft") {
      throw new TenderError("Le brouillon a changé de statut : rechargez la page.");
    }

    await tx
      .update(tenderRequests)
      .set({
        title: draft.title,
        notes: draft.notes,
        deadline: draft.deadline,
        updatedAt: new Date(),
      })
      .where(eq(tenderRequests.id, input.tenderId));

    await tx
      .delete(tenderRequestLines)
      .where(
        and(
          eq(tenderRequestLines.tenantId, input.tenantId),
          eq(tenderRequestLines.tenderId, input.tenderId),
        ),
      );
    await tx.insert(tenderRequestLines).values(
      draft.lines.map((line, index) => ({
        tenantId: input.tenantId,
        tenderId: input.tenderId,
        lineNumber: index + 1,
        articleId: line.articleId,
        name: line.name,
        unitCode: line.unitCode,
        qty: line.qty,
        requestedDate: line.requestedDate,
        note: line.note,
      })),
    );

    await tx
      .delete(tenderInvitations)
      .where(
        and(
          eq(tenderInvitations.tenantId, input.tenantId),
          eq(tenderInvitations.tenderId, input.tenderId),
        ),
      );
    await tx.insert(tenderInvitations).values(
      draft.suppliers.map((supplier) => ({
        tenantId: input.tenantId,
        tenderId: input.tenderId,
        supplierId: supplier.supplierId,
        recipientEmail: supplier.email,
        recipientName: supplier.name,
        status: "pending" as const,
      })),
    );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.update",
      entityType: "tender_request",
      entityId: input.tenderId,
      details: {
        title: draft.title,
        deadline: draft.deadline,
        lineCount: draft.lines.length,
        supplierCount: draft.suppliers.length,
      },
    });

    return { id: input.tenderId };
  });
}

export async function deleteTenderDraft(
  db: Database,
  input: { tenantId: string; actorUserId: string; tenderId: string },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ status: tenderRequests.status, title: tenderRequests.title })
      .from(tenderRequests)
      .where(
        and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)),
      )
      .for("update");
    if (!existing) {
      throw new TenderError("Demande de cotation introuvable dans cet espace de travail.");
    }
    if (existing.status !== "draft") {
      throw new TenderError("Une demande envoyée ne se supprime pas : annulez-la.");
    }
    await tx
      .delete(tenderRequests)
      .where(
        and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.delete",
      entityType: "tender_request",
      entityId: input.tenderId,
      details: { title: existing.title },
    });
  });
}

export interface SendTenderFailure {
  readonly invitationId: string;
  readonly supplierName: string;
  readonly error: string;
}

export interface SendTenderResult {
  readonly number: string;
  readonly delivered: number;
  readonly failures: readonly SendTenderFailure[];
}

async function requireMailAccount(db: Database, tenantId: string): Promise<MailAccountConfig> {
  const account = await getEmailAccountConfig(db, tenantId);
  if (!account || !account.active) {
    throw new TenderError("Compte d'envoi absent ou inactif : configurez-le avant d'envoyer.");
  }
  return account.config;
}

async function requireCompanyName(db: Database, tenantId: string): Promise<string> {
  const company = await getCompanySettings(db, tenantId);
  if (!company?.legalName) {
    throw new TenderError(
      "Complétez la raison sociale dans les paramètres avant d'envoyer une demande.",
    );
  }
  return company.legalName;
}

interface PendingTenderContext {
  readonly tender: TenderRequestRow;
  readonly lines: readonly TenderRequestLineRow[];
  readonly invitations: readonly {
    readonly id: string;
    readonly recipientEmail: string;
    readonly recipientName: string | null;
    readonly supplierName: string;
  }[];
}

async function loadPendingTender(
  db: Database,
  tenantId: string,
  tenderId: string,
): Promise<PendingTenderContext> {
  const [tender] = await db
    .select()
    .from(tenderRequests)
    .where(and(eq(tenderRequests.tenantId, tenantId), eq(tenderRequests.id, tenderId)))
    .limit(1);
  if (!tender) {
    throw new TenderError("Demande de cotation introuvable dans cet espace de travail.");
  }
  const lines = await db
    .select()
    .from(tenderRequestLines)
    .where(
      and(eq(tenderRequestLines.tenantId, tenantId), eq(tenderRequestLines.tenderId, tenderId)),
    )
    .orderBy(asc(tenderRequestLines.lineNumber));
  const invitations = await db
    .select({
      id: tenderInvitations.id,
      recipientEmail: tenderInvitations.recipientEmail,
      recipientName: tenderInvitations.recipientName,
      supplierName: partners.name,
    })
    .from(tenderInvitations)
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, tenderInvitations.tenantId),
        eq(partners.id, tenderInvitations.supplierId),
      ),
    )
    .where(and(eq(tenderInvitations.tenantId, tenantId), eq(tenderInvitations.tenderId, tenderId)))
    .orderBy(asc(partners.name));

  return { tender, lines, invitations };
}

function renderMail(
  context: PendingTenderContext,
  companyName: string,
  number: string,
  appUrl: string,
  token: string,
): { subject: string; text: string; html: string; link: string } {
  const link = buildQuoteLink(appUrl, token);
  const rendered = renderTenderEmail({
    companyName,
    number,
    title: context.tender.title,
    deadlineLabel: isoDateLabel(context.tender.deadline),
    lines: context.lines.map((line) => ({
      lineNumber: line.lineNumber,
      name: line.name,
      qty: line.qty,
      unitCode: line.unitCode,
    })),
    link,
  });
  return {
    subject: `Demande de cotation ${number} — ${context.tender.title}`,
    text: rendered.text,
    html: rendered.html,
    link,
  };
}

export async function sendTender(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    tenderId: string;
    appUrl: string;
  },
  factory: TransportFactory = defaultTransportFactory,
): Promise<SendTenderResult> {
  const companyName = await requireCompanyName(db, input.tenantId);
  const account = await requireMailAccount(db, input.tenantId);
  const context = await loadPendingTender(db, input.tenantId, input.tenderId);

  if (context.tender.status !== "draft") {
    throw new TenderError("Cette demande a déjà été envoyée.");
  }
  if (context.tender.deadline < todayIsoDate()) {
    throw new TenderError("Échéance dépassée : reportez la date avant l'envoi.");
  }
  if (context.lines.length === 0) {
    throw new TenderError("Ajoutez au moins une ligne de besoin avant l'envoi.");
  }
  if (context.invitations.length === 0) {
    throw new TenderError("Invitez au moins un fournisseur avant l'envoi.");
  }
  for (const invitation of context.invitations) {
    if (!isEmail(invitation.recipientEmail)) {
      throw new TenderError(
        `Fournisseur ${invitation.supplierName} : adresse e-mail invalide, corrigez la fiche tiers.`,
      );
    }
  }

  const expiresAt = tenderTokenExpiry(context.tender.deadline);
  const tokens = new Map(
    context.invitations.map((invitation) => [invitation.id, createTenderToken(expiresAt)]),
  );

  const number = await db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: tenderRequests.status })
      .from(tenderRequests)
      .where(
        and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)),
      )
      .for("update");
    if (!locked || locked.status !== "draft") {
      throw new TenderError("Cette demande a déjà été envoyée.");
    }

    const assigned = await nextDocumentNumber(tx, {
      tenantId: input.tenantId,
      scope: "tender",
    });
    await tx
      .update(tenderRequests)
      .set({
        number: assigned,
        status: "open",
        sentAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenderRequests.id, input.tenderId));

    for (const invitation of context.invitations) {
      const token = tokens.get(invitation.id);
      if (!token) {
        continue;
      }
      await tx
        .update(tenderInvitations)
        .set({
          tokenHash: token.hash,
          tokenExpiresAt: token.expiresAt,
          status: "pending",
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenderInvitations.tenantId, input.tenantId),
            eq(tenderInvitations.id, invitation.id),
          ),
        );
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.send",
      entityType: "tender_request",
      entityId: input.tenderId,
      details: {
        number: assigned,
        deadline: context.tender.deadline,
        supplierCount: context.invitations.length,
      },
    });

    return assigned;
  });

  const failures: SendTenderFailure[] = [];
  let delivered = 0;

  for (const invitation of context.invitations) {
    const token = tokens.get(invitation.id);
    if (!token) {
      continue;
    }
    const mail = renderMail(context, companyName, number, input.appUrl, token.token);
    try {
      const transport = factory(account);
      await transport.send({
        to: invitation.recipientEmail,
        toName: invitation.recipientName,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: [],
      });
      delivered += 1;
      await db
        .update(tenderInvitations)
        .set({ status: "sent", sentAt: new Date(), errorMessage: null, updatedAt: new Date() })
        .where(
          and(
            eq(tenderInvitations.tenantId, input.tenantId),
            eq(tenderInvitations.id, invitation.id),
          ),
        );
      await db.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "tender.invitation.send",
        entityType: "tender_invitation",
        entityId: invitation.id,
        details: {
          number,
          supplier: invitation.supplierName,
          recipient: invitation.recipientEmail,
          status: "sent",
        },
      });
    } catch (error) {
      const message = mailError(error);
      failures.push({
        invitationId: invitation.id,
        supplierName: invitation.supplierName,
        error: message,
      });
      await db
        .update(tenderInvitations)
        .set({
          tokenHash: null,
          tokenExpiresAt: null,
          errorMessage: message.slice(0, 1000),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(tenderInvitations.tenantId, input.tenantId),
            eq(tenderInvitations.id, invitation.id),
          ),
        );
      await db.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "tender.invitation.send",
        entityType: "tender_invitation",
        entityId: invitation.id,
        details: {
          number,
          supplier: invitation.supplierName,
          recipient: invitation.recipientEmail,
          status: "failed",
          error: message,
        },
      });
    }
  }

  return { number, delivered, failures };
}

export interface ResendInvitationResult {
  readonly recipient: string;
  readonly supplierName: string;
}

export async function resendTenderInvitation(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    tenderId: string;
    invitationId: string;
    appUrl: string;
  },
  factory: TransportFactory = defaultTransportFactory,
): Promise<ResendInvitationResult> {
  const companyName = await requireCompanyName(db, input.tenantId);
  const account = await requireMailAccount(db, input.tenantId);
  const context = await loadPendingTender(db, input.tenantId, input.tenderId);

  if (context.tender.status !== "open") {
    throw new TenderError("Seule une demande ouverte accepte un renvoi de lien.");
  }
  if (!context.tender.number) {
    throw new TenderError("Numéro de demande manquant : renvoyez la demande complète.");
  }
  if (context.tender.deadline < todayIsoDate()) {
    throw new TenderError("Échéance dépassée : le lien public est fermé.");
  }
  const invitation = context.invitations.find((row) => row.id === input.invitationId);
  if (!invitation) {
    throw new TenderError("Invitation introuvable pour cette demande.");
  }
  if (!isEmail(invitation.recipientEmail)) {
    throw new TenderError("Adresse e-mail du fournisseur invalide : corrigez la fiche tiers.");
  }

  const token = createTenderToken(tenderTokenExpiry(context.tender.deadline));
  const mail = renderMail(context, companyName, context.tender.number, input.appUrl, token.token);

  try {
    const transport = factory(account);
    await transport.send({
      to: invitation.recipientEmail,
      toName: invitation.recipientName,
      subject: mail.subject,
      text: mail.text,
      html: mail.html,
      attachments: [],
    });
  } catch (error) {
    const message = mailError(error);
    await db
      .update(tenderInvitations)
      .set({
        tokenHash: null,
        tokenExpiresAt: null,
        errorMessage: message.slice(0, 1000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(tenderInvitations.tenantId, input.tenantId),
          eq(tenderInvitations.id, invitation.id),
        ),
      );
    await db.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.invitation.resend",
      entityType: "tender_invitation",
      entityId: invitation.id,
      details: {
        number: context.tender.number,
        supplier: invitation.supplierName,
        status: "failed",
        error: message,
      },
    });
    throw new TenderError(`Renvoi refusé : ${message}`);
  }

  await db
    .update(tenderInvitations)
    .set({
      tokenHash: token.hash,
      tokenExpiresAt: token.expiresAt,
      status: "sent",
      sentAt: new Date(),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(
      and(eq(tenderInvitations.tenantId, input.tenantId), eq(tenderInvitations.id, invitation.id)),
    );
  await db.insert(auditEvents).values({
    tenantId: input.tenantId,
    actorUserId: input.actorUserId,
    action: "tender.invitation.resend",
    entityType: "tender_invitation",
    entityId: invitation.id,
    details: { number: context.tender.number, supplier: invitation.supplierName, status: "sent" },
  });

  return { recipient: invitation.recipientEmail, supplierName: invitation.supplierName };
}

export async function cancelTender(
  db: Database,
  input: { tenantId: string; actorUserId: string; tenderId: string; reason: string },
): Promise<void> {
  const reason = input.reason.trim();
  if (reason.length < 1 || reason.length > 500) {
    throw new TenderError("Motif d'annulation : 1 à 500 caractères.");
  }

  await db.transaction(async (tx) => {
    const [tender] = await tx
      .select({ status: tenderRequests.status, number: tenderRequests.number })
      .from(tenderRequests)
      .where(
        and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)),
      )
      .for("update");
    if (!tender) {
      throw new TenderError("Demande de cotation introuvable dans cet espace de travail.");
    }
    if (tender.status !== "open") {
      throw new TenderError("Seule une demande ouverte peut être annulée.");
    }

    await tx
      .update(tenderRequests)
      .set({
        status: "cancelled",
        cancelReason: reason,
        cancelledAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(tenderRequests.id, input.tenderId));
    await tx
      .update(tenderInvitations)
      .set({ tokenHash: null, tokenExpiresAt: null, updatedAt: new Date() })
      .where(
        and(
          eq(tenderInvitations.tenantId, input.tenantId),
          eq(tenderInvitations.tenderId, input.tenderId),
        ),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.cancel",
      entityType: "tender_request",
      entityId: input.tenderId,
      details: { number: tender.number, reason },
    });
  });
}

async function loadTenderLines(
  db: Database,
  tenantId: string,
  tenderId: string,
): Promise<TenderRequestLineRow[]> {
  return db
    .select()
    .from(tenderRequestLines)
    .where(
      and(eq(tenderRequestLines.tenantId, tenantId), eq(tenderRequestLines.tenderId, tenderId)),
    )
    .orderBy(asc(tenderRequestLines.lineNumber));
}

async function resolveOpenTender(
  db: Database,
  tenantId: string,
  tenderId: string,
): Promise<{ tender: TenderRequestRow; lines: TenderRequestLineRow[] }> {
  const [tender] = await db
    .select()
    .from(tenderRequests)
    .where(and(eq(tenderRequests.tenantId, tenantId), eq(tenderRequests.id, tenderId)))
    .limit(1);
  if (!tender) {
    throw new TenderError("Demande de cotation introuvable dans cet espace de travail.");
  }
  if (tender.status !== "open") {
    throw new TenderError("Cette demande n'est plus ouverte : aucune attribution possible.");
  }
  const lines = await loadTenderLines(db, tenantId, tenderId);
  return { tender, lines };
}

async function completeTenderIfResolved(
  tx: Parameters<Parameters<Database["transaction"]>[0]>[0],
  input: {
    tenantId: string;
    actorUserId: string;
    tenderId: string;
    lines: readonly TenderRequestLineRow[];
  },
): Promise<boolean> {
  const awarded = await tx
    .select({ tenderLineId: tenderAwards.tenderLineId })
    .from(tenderAwards)
    .where(
      and(eq(tenderAwards.tenantId, input.tenantId), eq(tenderAwards.tenderId, input.tenderId)),
    );
  const awardedIds = new Set(awarded.map((row) => row.tenderLineId));
  if (!isTenderFullyResolved(input.lines, awardedIds)) {
    return false;
  }
  const resolvedAt = new Date();
  await tx
    .update(tenderRequests)
    .set({
      status: "awarded",
      awardedAt: resolvedAt,
      awardedBy: input.actorUserId,
      updatedAt: resolvedAt,
    })
    .where(eq(tenderRequests.id, input.tenderId));
  return true;
}

export interface AwardTenderLineResult {
  readonly tenderStatus: TenderStatus;
}

export async function awardTenderLine(
  db: Database,
  input: {
    tenantId: string;
    actorUserId: string;
    tenderId: string;
    quoteLineId: string;
    motive: string;
  },
): Promise<AwardTenderLineResult> {
  const { tender, lines } = await resolveOpenTender(db, input.tenantId, input.tenderId);

  const [quoteLine] = await db
    .select({
      id: tenderQuoteLines.id,
      quoteId: tenderQuoteLines.quoteId,
      tenderLineId: tenderQuoteLines.tenderLineId,
      proposedQty: tenderQuoteLines.proposedQty,
      unitPriceXof: tenderQuoteLines.unitPriceXof,
      lineTotalXof: tenderQuoteLines.lineTotalXof,
    })
    .from(tenderQuoteLines)
    .where(
      and(
        eq(tenderQuoteLines.tenantId, input.tenantId),
        eq(tenderQuoteLines.id, input.quoteLineId),
      ),
    )
    .limit(1);
  if (!quoteLine) {
    throw new TenderError("Offre introuvable dans cet espace de travail.");
  }
  if (isZeroQuantity(quoteLine.proposedQty)) {
    throw new TenderError("Cette ligne n'est pas proposée par le fournisseur.");
  }

  const [quote] = await db
    .select()
    .from(tenderQuotes)
    .where(and(eq(tenderQuotes.tenantId, input.tenantId), eq(tenderQuotes.id, quoteLine.quoteId)))
    .limit(1);
  if (!quote || quote.tenderId !== input.tenderId) {
    throw new TenderError("Offre introuvable pour cette demande.");
  }
  if (quote.declined) {
    throw new TenderError("Le fournisseur a refusé de coter : offre indisponible.");
  }

  const line = lines.find((row) => row.id === quoteLine.tenderLineId);
  if (!line) {
    throw new TenderError("Ligne de besoin introuvable pour cette offre.");
  }
  if (line.rejected) {
    throw new TenderError("Cette ligne a été écartée : elle ne peut plus être attribuée.");
  }

  const [existingAward] = await db
    .select({ id: tenderAwards.id })
    .from(tenderAwards)
    .where(and(eq(tenderAwards.tenantId, input.tenantId), eq(tenderAwards.tenderLineId, line.id)))
    .limit(1);
  if (existingAward) {
    throw new TenderError(`Ligne ${line.lineNumber} : déjà attribuée.`);
  }

  const bundle = await loadLatestQuoteBundle(db, input.tenantId, input.tenderId);
  const latest = bundle.quotes.find((row) => row.invitationId === quote.invitationId);
  if (latest && latest.revision > quote.revision) {
    throw new TenderError(
      `Le fournisseur a déposé la révision ${latest.revision} : attribuez la version la plus récente.`,
    );
  }

  const cheapest = bestOffer(bundle.offers, line.id);
  const check = validateTenderAward({
    offer: {
      tenderLineId: line.id,
      quoteId: quote.id,
      quoteLineId: quoteLine.id,
      supplierId: quote.supplierId,
      supplierName: "",
      revision: quote.revision,
      proposedQty: quoteLine.proposedQty,
      unitPriceXof: quoteLine.unitPriceXof,
      lineTotalXof: quoteLine.lineTotalXof,
      leadTimeDays: quote.leadTimeDays,
      submittedAt: quote.submittedAt,
    },
    cheapest,
    requestedQty: line.qty,
    motive: input.motive,
  });
  if (check.errors.length > 0) {
    throw new TenderError(check.errors.join("\n"));
  }

  const tenderStatus = await db.transaction(async (tx) => {
    const [fresh] = await tx
      .select({ status: tenderRequests.status })
      .from(tenderRequests)
      .where(
        and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)),
      )
      .for("update");
    if (!fresh || fresh.status !== "open") {
      throw new TenderError("Cette demande n'est plus ouverte : aucune attribution possible.");
    }

    await tx.insert(tenderAwards).values({
      tenantId: input.tenantId,
      tenderId: input.tenderId,
      tenderLineId: line.id,
      quoteId: quote.id,
      quoteLineId: quoteLine.id,
      supplierId: quote.supplierId,
      qty: quoteLine.proposedQty,
      unitPriceXof: quoteLine.unitPriceXof,
      motive: check.motive,
      awardedBy: input.actorUserId,
    });

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.award",
      entityType: "tender_request",
      entityId: input.tenderId,
      details: {
        number: tender.number,
        lineNumber: line.lineNumber,
        supplierId: quote.supplierId,
        quoteRevision: quote.revision,
        qty: quoteLine.proposedQty,
        unitPriceXof: quoteLine.unitPriceXof,
        motive: check.motive,
        aboveBest: cheapest ? quoteLine.unitPriceXof > cheapest.unitPriceXof : false,
      },
    });

    const resolved = await completeTenderIfResolved(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      tenderId: input.tenderId,
      lines,
    });
    if (resolved) {
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "tender.awarded",
        entityType: "tender_request",
        entityId: input.tenderId,
        details: { number: tender.number },
      });
      return "awarded" as const;
    }
    return "open" as const;
  });

  return { tenderStatus };
}

export async function rejectTenderLine(
  db: Database,
  input: { tenantId: string; actorUserId: string; tenderId: string; tenderLineId: string },
): Promise<AwardTenderLineResult> {
  const { tender, lines } = await resolveOpenTender(db, input.tenantId, input.tenderId);
  const line = lines.find((row) => row.id === input.tenderLineId);
  if (!line) {
    throw new TenderError("Ligne de besoin introuvable pour cette demande.");
  }
  if (line.rejected) {
    throw new TenderError("Cette ligne est déjà écartée.");
  }

  const tenderStatus = await db.transaction(async (tx) => {
    const [existingAward] = await tx
      .select({ id: tenderAwards.id })
      .from(tenderAwards)
      .where(and(eq(tenderAwards.tenantId, input.tenantId), eq(tenderAwards.tenderLineId, line.id)))
      .limit(1);
    if (existingAward) {
      throw new TenderError("Cette ligne est déjà attribuée : elle ne peut plus être écartée.");
    }

    await tx
      .update(tenderRequestLines)
      .set({ rejected: true })
      .where(
        and(eq(tenderRequestLines.tenantId, input.tenantId), eq(tenderRequestLines.id, line.id)),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.line.reject",
      entityType: "tender_request",
      entityId: input.tenderId,
      details: { number: tender.number, lineNumber: line.lineNumber, name: line.name },
    });

    const resolvedLines = lines.map((row) =>
      row.id === line.id ? { ...row, rejected: true } : row,
    );
    const resolved = await completeTenderIfResolved(tx, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      tenderId: input.tenderId,
      lines: resolvedLines,
    });
    if (resolved) {
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "tender.awarded",
        entityType: "tender_request",
        entityId: input.tenderId,
        details: { number: tender.number },
      });
      return "awarded" as const;
    }
    return "open" as const;
  });

  return { tenderStatus };
}

export interface GenerateTenderOrdersResult {
  readonly orderIds: readonly string[];
}

export async function generateTenderPurchaseOrders(
  db: Database,
  input: { tenantId: string; actorUserId: string; tenderId: string },
): Promise<GenerateTenderOrdersResult> {
  const [tender] = await db
    .select()
    .from(tenderRequests)
    .where(and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)))
    .limit(1);
  if (!tender) {
    throw new TenderError("Demande de cotation introuvable dans cet espace de travail.");
  }
  if (tender.status !== "awarded") {
    throw new TenderError("Les commandes exigent une demande entièrement attribuée.");
  }
  if (tender.ordersCreatedAt) {
    throw new TenderError("Les commandes de cette demande ont déjà été créées.");
  }

  const awardRows = await db
    .select({
      tenderLineId: tenderAwards.tenderLineId,
      supplierId: tenderAwards.supplierId,
      quoteId: tenderAwards.quoteId,
      qty: tenderAwards.qty,
      unitPriceXof: tenderAwards.unitPriceXof,
      lineNumber: tenderRequestLines.lineNumber,
      articleId: tenderRequestLines.articleId,
      name: tenderRequestLines.name,
      unitCode: tenderRequestLines.unitCode,
      leadTimeDays: tenderQuotes.leadTimeDays,
      articleType: articles.type,
    })
    .from(tenderAwards)
    .innerJoin(
      tenderRequestLines,
      and(
        eq(tenderRequestLines.tenantId, tenderAwards.tenantId),
        eq(tenderRequestLines.id, tenderAwards.tenderLineId),
      ),
    )
    .innerJoin(
      articles,
      and(
        eq(articles.tenantId, tenderRequestLines.tenantId),
        eq(articles.id, tenderRequestLines.articleId),
      ),
    )
    .innerJoin(
      tenderQuotes,
      and(
        eq(tenderQuotes.tenantId, tenderAwards.tenantId),
        eq(tenderQuotes.id, tenderAwards.quoteId),
      ),
    )
    .where(
      and(eq(tenderAwards.tenantId, input.tenantId), eq(tenderAwards.tenderId, input.tenderId)),
    )
    .orderBy(asc(tenderRequestLines.lineNumber));

  if (awardRows.length === 0) {
    throw new TenderError("Aucune ligne attribuée : il n'y a pas de commande à créer.");
  }

  const groups = new Map<string, typeof awardRows>();
  for (const award of awardRows) {
    const list = groups.get(award.supplierId);
    if (list) {
      list.push(award);
    } else {
      groups.set(award.supplierId, [award]);
    }
  }

  const today = todayIsoDate();

  return db.transaction(async (tx) => {
    const [locked] = await tx
      .select({ status: tenderRequests.status, ordersCreatedAt: tenderRequests.ordersCreatedAt })
      .from(tenderRequests)
      .where(
        and(eq(tenderRequests.tenantId, input.tenantId), eq(tenderRequests.id, input.tenderId)),
      )
      .for("update");
    if (!locked || locked.status !== "awarded") {
      throw new TenderError("Les commandes exigent une demande entièrement attribuée.");
    }
    if (locked.ordersCreatedAt) {
      throw new TenderError("Les commandes de cette demande ont déjà été créées.");
    }

    const orderIds: string[] = [];

    for (const [supplierId, awards] of groups) {
      const leadTimes = awards
        .map((award) => award.leadTimeDays)
        .filter((value): value is number => value !== null);
      const leadTime = leadTimes.length > 0 ? Math.max(...leadTimes) : null;
      const lines = awards.map((award) => ({
        lineNumber: award.lineNumber,
        articleId: award.articleId,
        name: award.name,
        unitCode: award.unitCode,
        qty: award.qty,
        unitPriceXof: award.unitPriceXof,
        lineTotalXof: computeLineTotal(award.qty, award.unitPriceXof),
        articleType: award.articleType,
      }));
      const exTaxTotal = lines.reduce((sum, line) => sum + line.lineTotalXof, 0);
      const receiptState = computeOrderReceiptState(
        lines.map((line) => ({ type: line.articleType, receiptState: "not_received" as const })),
      );

      const [created] = await tx
        .insert(purchaseOrders)
        .values({
          tenantId: input.tenantId,
          supplierId,
          tenderId: input.tenderId,
          status: "draft",
          receiptState,
          orderDate: today,
          expectedReceiptDate: leadTime === null ? null : addDaysIso(today, leadTime),
          externalReference: tender.number,
          notes: tender.number ? `Attribution ${tender.number}` : null,
          exTaxTotal,
          createdBy: input.actorUserId,
        })
        .returning({ id: purchaseOrders.id });
      if (!created) {
        throw new TenderError("Une commande n'a pas pu être créée.");
      }
      orderIds.push(created.id);

      await tx.insert(purchaseOrderLines).values(
        lines.map((line, index) => ({
          tenantId: input.tenantId,
          orderId: created.id,
          lineNumber: index + 1,
          articleId: line.articleId,
          name: line.name,
          unitCode: line.unitCode,
          qty: line.qty,
          unitPriceXof: line.unitPriceXof,
          lineTotalXof: line.lineTotalXof,
          receivedQty: "0",
          receiptState: "not_received" as const,
        })),
      );

      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "purchase.order.create",
        entityType: "purchase_order",
        entityId: created.id,
        details: {
          source: "tender",
          tenderId: input.tenderId,
          tenderNumber: tender.number,
          supplierId,
          lineCount: lines.length,
          exTaxTotal,
        },
      });
    }

    await tx
      .update(tenderRequests)
      .set({ ordersCreatedAt: new Date(), updatedAt: new Date() })
      .where(eq(tenderRequests.id, input.tenderId));

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "tender.orders.create",
      entityType: "tender_request",
      entityId: input.tenderId,
      details: {
        number: tender.number,
        orderCount: orderIds.length,
        orderIds,
      },
    });

    return { orderIds };
  });
}

export function tenderOffersByLine(offers: readonly TenderOffer[]): Map<string, TenderOffer[]> {
  return offersByLine(offers);
}

export function remainingTenderLineIds(
  lines: readonly TenderRequestLineRow[],
  awards: readonly { readonly tenderLineId: string }[],
): string[] {
  const awarded = new Set(awards.map((award) => award.tenderLineId));
  return lines.filter((line) => !line.rejected && !awarded.has(line.id)).map((line) => line.id);
}
