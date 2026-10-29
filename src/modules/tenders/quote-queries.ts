import { and, asc, desc, eq, isNull } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  companySettings,
  partners,
  tenderInvitations,
  tenderQuoteLines,
  tenderQuotes,
  tenderRequestLines,
  tenderRequests,
} from "@/db/schema";
import { isoDateLabel, todayIsoDate } from "@/lib/dates";
import { isZeroQuantity } from "@/modules/stock/quantities";
import { TenderError } from "./errors";
import { MAX_QUOTE_REVISIONS, validateTenderQuote, type TenderQuoteRaw } from "./quotes";
import { hashTenderToken, isTenderTokenShape } from "./rules";

export interface PublicTenderLine {
  readonly id: string;
  readonly lineNumber: number;
  readonly name: string;
  readonly unitCode: string;
  readonly qty: string;
  readonly requestedDate: string | null;
  readonly note: string | null;
}

export interface PublicTenderQuoteLine {
  readonly tenderLineId: string;
  readonly proposedQty: string;
  readonly unitPriceXof: number;
}

export interface PublicTenderQuote {
  readonly revision: number;
  readonly authorName: string;
  readonly authorEmail: string | null;
  readonly leadTimeDays: number | null;
  readonly comment: string | null;
  readonly declined: boolean;
  readonly lines: readonly PublicTenderQuoteLine[];
  readonly submittedAt: Date;
}

export interface PublicTenderContext {
  readonly tenantId: string;
  readonly invitationId: string;
  readonly tenderId: string;
  readonly companyName: string;
  readonly number: string;
  readonly title: string;
  readonly deadline: string;
  readonly deadlineLabel: string;
  readonly supplierName: string;
  readonly recipientName: string | null;
  readonly lines: readonly PublicTenderLine[];
  readonly latestQuote: PublicTenderQuote | null;
  readonly revisionCount: number;
}

async function loadPublicContext(
  db: Database,
  token: string,
  now: Date,
): Promise<PublicTenderContext | null> {
  if (!isTenderTokenShape(token)) {
    return null;
  }

  const [row] = await db
    .select({
      invitationId: tenderInvitations.id,
      tenantId: tenderInvitations.tenantId,
      invitationStatus: tenderInvitations.status,
      recipientName: tenderInvitations.recipientName,
      tokenExpiresAt: tenderInvitations.tokenExpiresAt,
      tenderId: tenderRequests.id,
      number: tenderRequests.number,
      title: tenderRequests.title,
      deadline: tenderRequests.deadline,
      status: tenderRequests.status,
      supplierName: partners.name,
    })
    .from(tenderInvitations)
    .innerJoin(
      tenderRequests,
      and(
        eq(tenderRequests.tenantId, tenderInvitations.tenantId),
        eq(tenderRequests.id, tenderInvitations.tenderId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, tenderInvitations.tenantId),
        eq(partners.id, tenderInvitations.supplierId),
      ),
    )
    .where(eq(tenderInvitations.tokenHash, hashTenderToken(token)))
    .limit(1);

  if (!row || !row.number || !row.tokenExpiresAt) {
    return null;
  }
  if (row.tokenExpiresAt.getTime() <= now.getTime()) {
    return null;
  }
  if (row.status !== "open") {
    return null;
  }
  if (row.deadline < todayIsoDate(now)) {
    return null;
  }

  const [company] = await db
    .select({ legalName: companySettings.legalName })
    .from(companySettings)
    .where(eq(companySettings.tenantId, row.tenantId))
    .limit(1);
  if (!company?.legalName) {
    return null;
  }

  const lineRows = await db
    .select({
      id: tenderRequestLines.id,
      lineNumber: tenderRequestLines.lineNumber,
      name: tenderRequestLines.name,
      unitCode: tenderRequestLines.unitCode,
      qty: tenderRequestLines.qty,
      requestedDate: tenderRequestLines.requestedDate,
      note: tenderRequestLines.note,
      rejected: tenderRequestLines.rejected,
    })
    .from(tenderRequestLines)
    .where(
      and(
        eq(tenderRequestLines.tenantId, row.tenantId),
        eq(tenderRequestLines.tenderId, row.tenderId),
      ),
    )
    .orderBy(asc(tenderRequestLines.lineNumber));

  const quoteRows = await db
    .select()
    .from(tenderQuotes)
    .where(
      and(eq(tenderQuotes.tenantId, row.tenantId), eq(tenderQuotes.invitationId, row.invitationId)),
    )
    .orderBy(desc(tenderQuotes.revision));

  const latest = quoteRows[0] ?? null;
  const quoteLineRows = latest
    ? await db
        .select({
          tenderLineId: tenderQuoteLines.tenderLineId,
          proposedQty: tenderQuoteLines.proposedQty,
          unitPriceXof: tenderQuoteLines.unitPriceXof,
        })
        .from(tenderQuoteLines)
        .where(
          and(eq(tenderQuoteLines.tenantId, row.tenantId), eq(tenderQuoteLines.quoteId, latest.id)),
        )
    : [];

  return {
    tenantId: row.tenantId,
    invitationId: row.invitationId,
    tenderId: row.tenderId,
    companyName: company.legalName,
    number: row.number,
    title: row.title,
    deadline: row.deadline,
    deadlineLabel: isoDateLabel(row.deadline),
    supplierName: row.supplierName,
    recipientName: row.recipientName,
    lines: lineRows
      .filter((line) => !line.rejected)
      .map((line) => ({
        id: line.id,
        lineNumber: line.lineNumber,
        name: line.name,
        unitCode: line.unitCode,
        qty: line.qty,
        requestedDate: line.requestedDate,
        note: line.note,
      })),
    latestQuote: latest
      ? {
          revision: latest.revision,
          authorName: latest.authorName,
          authorEmail: latest.authorEmail,
          leadTimeDays: latest.leadTimeDays,
          comment: latest.comment,
          declined: latest.declined,
          lines: quoteLineRows,
          submittedAt: latest.submittedAt,
        }
      : null,
    revisionCount: quoteRows.length,
  };
}

export async function getPublicTender(
  db: Database,
  token: string,
): Promise<PublicTenderContext | null> {
  return loadPublicContext(db, token, new Date());
}

export async function markTenderInvitationViewed(
  db: Database,
  context: PublicTenderContext,
): Promise<void> {
  await db
    .update(tenderInvitations)
    .set({ firstViewedAt: new Date(), updatedAt: new Date() })
    .where(
      and(
        eq(tenderInvitations.tenantId, context.tenantId),
        eq(tenderInvitations.id, context.invitationId),
        isNull(tenderInvitations.firstViewedAt),
      ),
    );
}

export interface SubmitTenderQuoteResult {
  readonly revision: number;
  readonly declined: boolean;
}

export async function submitTenderQuote(
  db: Database,
  input: { token: string; data: TenderQuoteRaw },
): Promise<SubmitTenderQuoteResult> {
  const now = new Date();
  const context = await loadPublicContext(db, input.token, now);
  if (!context) {
    throw new TenderError("Ce lien de cotation n'est plus actif.");
  }

  const validation = validateTenderQuote(
    input.data,
    context.lines.map((line) => ({ id: line.id, lineNumber: line.lineNumber, qty: line.qty })),
  );
  if (!validation.quote) {
    throw new TenderError(
      validation.errors.length > 0
        ? validation.errors.join("\n")
        : "La cotation n'a pas pu être validée.",
    );
  }
  const quote = validation.quote;
  const tenderLineNumberById = new Map(context.lines.map((line) => [line.id, line.lineNumber]));

  return db.transaction(async (tx) => {
    const [invitation] = await tx
      .select({
        id: tenderInvitations.id,
        tenantId: tenderInvitations.tenantId,
        tenderId: tenderInvitations.tenderId,
        supplierId: tenderInvitations.supplierId,
        tokenExpiresAt: tenderInvitations.tokenExpiresAt,
      })
      .from(tenderInvitations)
      .where(eq(tenderInvitations.id, context.invitationId))
      .for("update");
    if (!invitation || !invitation.tokenExpiresAt) {
      throw new TenderError("Ce lien de cotation n'est plus actif.");
    }
    if (invitation.tokenExpiresAt.getTime() <= now.getTime()) {
      throw new TenderError("Le délai de cotation est dépassé.");
    }

    const [tender] = await tx
      .select({ status: tenderRequests.status, deadline: tenderRequests.deadline })
      .from(tenderRequests)
      .where(
        and(
          eq(tenderRequests.tenantId, invitation.tenantId),
          eq(tenderRequests.id, invitation.tenderId),
        ),
      )
      .for("update");
    if (!tender || tender.status !== "open" || tender.deadline < todayIsoDate(now)) {
      throw new TenderError("Cette demande n'accepte plus de cotation.");
    }

    const existing = await tx
      .select({ revision: tenderQuotes.revision })
      .from(tenderQuotes)
      .where(
        and(
          eq(tenderQuotes.tenantId, invitation.tenantId),
          eq(tenderQuotes.invitationId, invitation.id),
        ),
      )
      .orderBy(desc(tenderQuotes.revision))
      .limit(1);
    const nextRevision = (existing[0]?.revision ?? 0) + 1;
    if (nextRevision > MAX_QUOTE_REVISIONS) {
      throw new TenderError(
        `Révisions : ${MAX_QUOTE_REVISIONS} dépôts maximum par fournisseur. Contactez l'acheteur.`,
      );
    }

    const [created] = await tx
      .insert(tenderQuotes)
      .values({
        tenantId: invitation.tenantId,
        tenderId: invitation.tenderId,
        invitationId: invitation.id,
        supplierId: invitation.supplierId,
        revision: nextRevision,
        authorName: quote.authorName,
        authorEmail: quote.authorEmail,
        leadTimeDays: quote.leadTimeDays,
        comment: quote.comment,
        declined: quote.declined,
        totalXof: quote.totalXof,
        submittedAt: now,
      })
      .returning({ id: tenderQuotes.id });
    if (!created) {
      throw new TenderError("La cotation n'a pas pu être enregistrée.");
    }

    if (quote.lines.length > 0) {
      await tx.insert(tenderQuoteLines).values(
        quote.lines.map((line) => ({
          tenantId: invitation.tenantId,
          quoteId: created.id,
          tenderLineId: line.tenderLineId,
          proposedQty: line.proposedQty,
          unitPriceXof: line.unitPriceXof,
          lineTotalXof: line.lineTotalXof,
        })),
      );
    }

    await tx
      .update(tenderInvitations)
      .set({
        status: quote.declined ? "declined" : "quoted",
        lastQuotedAt: now,
        firstViewedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(tenderInvitations.tenantId, invitation.tenantId),
          eq(tenderInvitations.id, invitation.id),
        ),
      );

    await tx.insert(auditEvents).values({
      tenantId: invitation.tenantId,
      actorUserId: null,
      action: "tender.quote.submit",
      entityType: "tender_request",
      entityId: invitation.tenderId,
      details: {
        invitationId: invitation.id,
        supplierId: invitation.supplierId,
        supplierName: context.supplierName,
        revision: nextRevision,
        declined: quote.declined,
        totalXof: quote.totalXof,
        offeredLines: quote.lines
          .filter((line) => !isZeroQuantity(line.proposedQty))
          .map((line) => tenderLineNumberById.get(line.tenderLineId) ?? null),
      },
    });

    return { revision: nextRevision, declined: quote.declined };
  });
}
