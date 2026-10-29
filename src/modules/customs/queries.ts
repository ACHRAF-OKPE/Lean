import { and, asc, count, desc, eq, inArray, sql } from "drizzle-orm";
import type { Database } from "@/db/client";
import {
  auditEvents,
  customsApurements,
  customsBonds,
  customsDeclarationLines,
  customsDeclarationTaxes,
  customsDeclarations,
  customsOffices,
  customsPayments,
  customsRegimes,
  customsTaxes,
  hsCodes,
  partners,
  users,
  type CustomsApurementMode,
  type CustomsBondStatus,
  type CustomsDeclarationStatus,
  type CustomsRegimeKind,
  type CustomsTaxBase,
  type PaymentMethod,
} from "@/db/schema";
import { nextDocumentNumber } from "@/modules/stock/sequences";
import { microsToQuantity, quantityToMicros } from "@/modules/stock/quantities";
import { CUSTOMS_LIST_LIMIT } from "./constants";
import { CustomsError } from "./errors";
import {
  cancellationContextError,
  clearingContextError,
  transitionError,
  type DeclarationTransition,
} from "./lifecycle";
import { liquidateDeclaration } from "./liquidation";
import {
  apurementContextError,
  declarationApurementProgress,
  lineApurementProgress,
  type ApurementLineState,
  type DeclarationApurementProgress,
} from "./apurement";
import {
  validateApurementEntryInput,
  validateApurementReference,
  validateBondInput,
  validateDeclarationHeader,
  validateDeclarationLine,
  validateOfficeInput,
  validatePaymentInput,
  validateRegimeInput,
  validateTaxInput,
} from "./validation";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

function assertValid<T>(
  result: { data: T | null; errors: readonly string[] },
  fallback: string,
): T {
  if (!result.data || result.errors.length > 0) {
    throw new CustomsError(result.errors[0] ?? fallback);
  }
  return result.data;
}

function isUniqueViolation(error: unknown): boolean {
  const candidate = error as { code?: string; cause?: { code?: string } };
  return candidate?.code === "23505" || candidate?.cause?.code === "23505";
}

export interface CustomsOfficeSummary {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly active: boolean;
}

export interface CustomsRegimeSummary {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly kind: CustomsRegimeKind;
  readonly requiresBond: boolean;
  readonly requiresApurement: boolean;
  readonly active: boolean;
}

export interface CustomsTaxSummary {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly base: CustomsTaxBase;
  readonly rateBp: number;
  readonly position: number;
  readonly active: boolean;
}

export interface CustomsReferentials {
  readonly offices: readonly CustomsOfficeSummary[];
  readonly regimes: readonly CustomsRegimeSummary[];
  readonly taxes: readonly CustomsTaxSummary[];
}

export async function listCustomsReferentials(
  db: Database,
  tenantId: string,
): Promise<CustomsReferentials> {
  const [offices, regimes, taxes] = await Promise.all([
    db
      .select({
        id: customsOffices.id,
        code: customsOffices.code,
        name: customsOffices.name,
        active: customsOffices.active,
      })
      .from(customsOffices)
      .where(eq(customsOffices.tenantId, tenantId))
      .orderBy(asc(customsOffices.code)),
    db
      .select({
        id: customsRegimes.id,
        code: customsRegimes.code,
        label: customsRegimes.label,
        kind: customsRegimes.kind,
        requiresBond: customsRegimes.requiresBond,
        requiresApurement: customsRegimes.requiresApurement,
        active: customsRegimes.active,
      })
      .from(customsRegimes)
      .where(eq(customsRegimes.tenantId, tenantId))
      .orderBy(asc(customsRegimes.code)),
    db
      .select({
        id: customsTaxes.id,
        code: customsTaxes.code,
        label: customsTaxes.label,
        base: customsTaxes.base,
        rateBp: customsTaxes.rateBp,
        position: customsTaxes.position,
        active: customsTaxes.active,
      })
      .from(customsTaxes)
      .where(eq(customsTaxes.tenantId, tenantId))
      .orderBy(asc(customsTaxes.position), asc(customsTaxes.code)),
  ]);
  return { offices, regimes, taxes };
}

export async function createCustomsOffice(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: { code: unknown; name: unknown };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateOfficeInput(input.raw), "Bureau invalide.");
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(customsOffices)
        .values({ tenantId: input.tenantId, code: data.code, name: data.name })
        .returning({ id: customsOffices.id });
      if (!created) {
        throw new CustomsError("Le bureau n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "customs.office.create",
        entityType: "customs_office",
        entityId: created.id,
        details: { code: data.code, name: data.name },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CustomsError(`Le bureau ${data.code} existe déjà dans cet espace.`);
    }
    throw error;
  }
}

export async function setCustomsOfficeActive(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly officeId: string;
    readonly active: boolean;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [office] = await tx
      .select({ id: customsOffices.id, code: customsOffices.code, active: customsOffices.active })
      .from(customsOffices)
      .where(
        and(eq(customsOffices.tenantId, input.tenantId), eq(customsOffices.id, input.officeId)),
      )
      .limit(1)
      .for("update");
    if (!office) {
      throw new CustomsError("Bureau introuvable dans cet espace.");
    }
    if (office.active === input.active) {
      return;
    }
    await tx
      .update(customsOffices)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(eq(customsOffices.tenantId, input.tenantId), eq(customsOffices.id, input.officeId)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.office.status",
      entityType: "customs_office",
      entityId: office.id,
      details: { code: office.code, before: office.active, after: input.active },
    });
  });
}

export async function createCustomsRegime(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: {
      code: unknown;
      label: unknown;
      kind: unknown;
      requiresBond: unknown;
      requiresApurement?: unknown;
    };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateRegimeInput(input.raw), "Régime invalide.");
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(customsRegimes)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          label: data.label,
          kind: data.kind,
          requiresBond: data.requiresBond,
          requiresApurement: data.requiresApurement,
        })
        .returning({ id: customsRegimes.id });
      if (!created) {
        throw new CustomsError("Le régime n'a pas pu être créé.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "customs.regime.create",
        entityType: "customs_regime",
        entityId: created.id,
        details: {
          code: data.code,
          label: data.label,
          kind: data.kind,
          requiresBond: data.requiresBond,
          requiresApurement: data.requiresApurement,
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CustomsError(`Le régime ${data.code} existe déjà dans cet espace.`);
    }
    throw error;
  }
}

export async function setCustomsRegimeActive(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly regimeId: string;
    readonly active: boolean;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [regime] = await tx
      .select({ id: customsRegimes.id, code: customsRegimes.code, active: customsRegimes.active })
      .from(customsRegimes)
      .where(
        and(eq(customsRegimes.tenantId, input.tenantId), eq(customsRegimes.id, input.regimeId)),
      )
      .limit(1)
      .for("update");
    if (!regime) {
      throw new CustomsError("Régime introuvable dans cet espace.");
    }
    if (regime.active === input.active) {
      return;
    }
    await tx
      .update(customsRegimes)
      .set({ active: input.active, updatedAt: new Date() })
      .where(
        and(eq(customsRegimes.tenantId, input.tenantId), eq(customsRegimes.id, input.regimeId)),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.regime.status",
      entityType: "customs_regime",
      entityId: regime.id,
      details: { code: regime.code, before: regime.active, after: input.active },
    });
  });
}

export async function createCustomsTax(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: {
      code: unknown;
      label: unknown;
      base: unknown;
      rateBp: unknown;
      position: unknown;
    };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateTaxInput(input.raw), "Taxe invalide.");
  try {
    return await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(customsTaxes)
        .values({
          tenantId: input.tenantId,
          code: data.code,
          label: data.label,
          base: data.base,
          rateBp: data.rateBp,
          position: data.position,
        })
        .returning({ id: customsTaxes.id });
      if (!created) {
        throw new CustomsError("La taxe n'a pas pu être créée.");
      }
      await tx.insert(auditEvents).values({
        tenantId: input.tenantId,
        actorUserId: input.actorUserId,
        action: "customs.tax.create",
        entityType: "customs_tax",
        entityId: created.id,
        details: {
          code: data.code,
          label: data.label,
          base: data.base,
          rateBp: data.rateBp,
          position: data.position,
        },
      });
      return created;
    });
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new CustomsError(`La taxe ${data.code} existe déjà dans cet espace.`);
    }
    throw error;
  }
}

export async function setCustomsTaxActive(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly taxId: string;
    readonly active: boolean;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [tax] = await tx
      .select({ id: customsTaxes.id, code: customsTaxes.code, active: customsTaxes.active })
      .from(customsTaxes)
      .where(and(eq(customsTaxes.tenantId, input.tenantId), eq(customsTaxes.id, input.taxId)))
      .limit(1)
      .for("update");
    if (!tax) {
      throw new CustomsError("Taxe introuvable dans cet espace.");
    }
    if (tax.active === input.active) {
      return;
    }
    await tx
      .update(customsTaxes)
      .set({ active: input.active, updatedAt: new Date() })
      .where(and(eq(customsTaxes.tenantId, input.tenantId), eq(customsTaxes.id, input.taxId)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.tax.status",
      entityType: "customs_tax",
      entityId: tax.id,
      details: { code: tax.code, before: tax.active, after: input.active },
    });
  });
}

export interface DeclarationSummary {
  readonly id: string;
  readonly number: string;
  readonly status: CustomsDeclarationStatus;
  readonly declarationDate: string;
  readonly externalReference: string | null;
  readonly regimeCode: string;
  readonly regimeLabel: string;
  readonly requiresApurement: boolean;
  readonly officeCode: string;
  readonly partnerCode: string;
  readonly partnerName: string;
  readonly grandTotal: number;
  readonly paidTotal: number;
  readonly bondStatus: CustomsBondStatus | null;
}

const DECLARATION_LIST_COLUMNS = {
  id: customsDeclarations.id,
  number: customsDeclarations.number,
  status: customsDeclarations.status,
  declarationDate: customsDeclarations.declarationDate,
  externalReference: customsDeclarations.externalReference,
  regimeCode: customsRegimes.code,
  regimeLabel: customsRegimes.label,
  requiresApurement: customsRegimes.requiresApurement,
  officeCode: customsOffices.code,
  partnerCode: partners.code,
  partnerName: partners.name,
  grandTotal: customsDeclarations.grandTotal,
  paidTotal: customsDeclarations.paidTotal,
  bondStatus: customsBonds.status,
} as const;

export async function listDeclarations(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly status?: CustomsDeclarationStatus | "all";
    readonly limit?: number;
  },
): Promise<readonly DeclarationSummary[]> {
  const conditions = [eq(customsDeclarations.tenantId, input.tenantId)];
  if (input.status && input.status !== "all") {
    conditions.push(eq(customsDeclarations.status, input.status));
  }
  return db
    .select(DECLARATION_LIST_COLUMNS)
    .from(customsDeclarations)
    .innerJoin(
      customsRegimes,
      and(
        eq(customsRegimes.tenantId, customsDeclarations.tenantId),
        eq(customsRegimes.id, customsDeclarations.regimeId),
      ),
    )
    .innerJoin(
      customsOffices,
      and(
        eq(customsOffices.tenantId, customsDeclarations.tenantId),
        eq(customsOffices.id, customsDeclarations.officeId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, customsDeclarations.tenantId),
        eq(partners.id, customsDeclarations.partnerId),
      ),
    )
    .leftJoin(
      customsBonds,
      and(
        eq(customsBonds.tenantId, customsDeclarations.tenantId),
        eq(customsBonds.declarationId, customsDeclarations.id),
      ),
    )
    .where(and(...conditions))
    .orderBy(desc(customsDeclarations.declarationDate), desc(customsDeclarations.createdAt))
    .limit(Math.min(Math.max(input.limit ?? CUSTOMS_LIST_LIMIT, 1), CUSTOMS_LIST_LIMIT));
}

export interface CustomsDeclarationOptions {
  readonly offices: readonly { id: string; code: string; name: string }[];
  readonly regimes: readonly {
    id: string;
    code: string;
    label: string;
    requiresBond: boolean;
    requiresApurement: boolean;
  }[];
  readonly partners: readonly { id: string; code: string; name: string }[];
  readonly hsCodes: readonly { code: string; wording: string; tecRate: number | null }[];
}

export async function getDeclarationOptions(
  db: Database,
  tenantId: string,
): Promise<CustomsDeclarationOptions> {
  const [offices, regimes, partnerRows, hsCodeRows] = await Promise.all([
    db
      .select({ id: customsOffices.id, code: customsOffices.code, name: customsOffices.name })
      .from(customsOffices)
      .where(and(eq(customsOffices.tenantId, tenantId), eq(customsOffices.active, true)))
      .orderBy(asc(customsOffices.code)),
    db
      .select({
        id: customsRegimes.id,
        code: customsRegimes.code,
        label: customsRegimes.label,
        requiresBond: customsRegimes.requiresBond,
        requiresApurement: customsRegimes.requiresApurement,
      })
      .from(customsRegimes)
      .where(and(eq(customsRegimes.tenantId, tenantId), eq(customsRegimes.active, true)))
      .orderBy(asc(customsRegimes.code)),
    db
      .select({ id: partners.id, code: partners.code, name: partners.name })
      .from(partners)
      .where(and(eq(partners.tenantId, tenantId), eq(partners.active, true)))
      .orderBy(asc(partners.name))
      .limit(500),
    db
      .select({ code: hsCodes.code, wording: hsCodes.wording, tecRate: hsCodes.tecRate })
      .from(hsCodes)
      .where(eq(hsCodes.tenantId, tenantId))
      .orderBy(asc(hsCodes.code))
      .limit(500),
  ]);
  return { offices, regimes, partners: partnerRows, hsCodes: hsCodeRows };
}

export interface CustomsCounters {
  readonly total: number;
  readonly draft: number;
  readonly deposited: number;
  readonly liquidated: number;
  readonly cleared: number;
  readonly awaitingPayment: number;
}

export async function customsCounters(db: Database, tenantId: string): Promise<CustomsCounters> {
  const [row] = await db
    .select({
      total: count(),
      draft: count(sql`case when ${customsDeclarations.status} = 'draft' then 1 end`),
      deposited: count(sql`case when ${customsDeclarations.status} = 'deposited' then 1 end`),
      liquidated: count(sql`case when ${customsDeclarations.status} = 'liquidated' then 1 end`),
      cleared: count(sql`case when ${customsDeclarations.status} = 'cleared' then 1 end`),
      awaitingPayment: count(
        sql`case when ${customsDeclarations.status} = 'liquidated' and ${customsDeclarations.paidTotal} < ${customsDeclarations.grandTotal} then 1 end`,
      ),
    })
    .from(customsDeclarations)
    .where(eq(customsDeclarations.tenantId, tenantId));
  return {
    total: row?.total ?? 0,
    draft: row?.draft ?? 0,
    deposited: row?.deposited ?? 0,
    liquidated: row?.liquidated ?? 0,
    cleared: row?.cleared ?? 0,
    awaitingPayment: row?.awaitingPayment ?? 0,
  };
}

export interface DeclarationHeaderDetail {
  readonly id: string;
  readonly number: string;
  readonly status: CustomsDeclarationStatus;
  readonly declarationDate: string;
  readonly externalReference: string | null;
  readonly freightAmount: number;
  readonly insuranceAmount: number;
  readonly cifTotal: number;
  readonly dutyTotal: number;
  readonly taxTotal: number;
  readonly grandTotal: number;
  readonly paidTotal: number;
  readonly liquidatedAt: Date | null;
  readonly clearedAt: Date | null;
  readonly cancelledAt: Date | null;
  readonly createdAt: Date;
  readonly regimeId: string;
  readonly regimeCode: string;
  readonly regimeLabel: string;
  readonly regimeKind: CustomsRegimeKind;
  readonly requiresBond: boolean;
  readonly requiresApurement: boolean;
  readonly officeId: string;
  readonly officeCode: string;
  readonly officeName: string;
  readonly partnerId: string;
  readonly partnerCode: string;
  readonly partnerName: string;
}

export interface DeclarationLineDetail {
  readonly id: string;
  readonly lineNumber: number;
  readonly hsCode: string;
  readonly designation: string;
  readonly quantity: string;
  readonly unitCode: string;
  readonly valueXof: number;
  readonly weightKg: string | null;
  readonly originCountry: string;
  readonly cifValue: number;
  readonly dutyRate: number | null;
  readonly dutyAmount: number;
  readonly apuredQuantity: string;
  readonly remainingQuantity: string;
  readonly apurementRateBp: number;
  readonly apurementState: ApurementLineState;
}

export interface ApurementEntryDetail {
  readonly id: string;
  readonly lineId: string;
  readonly lineNumber: number;
  readonly quantity: string;
  readonly apuredAt: string;
  readonly mode: CustomsApurementMode;
  readonly reference: string;
  readonly createdAt: Date;
  readonly createdByName: string | null;
}

export interface DeclarationTaxDetail {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly base: CustomsTaxBase;
  readonly baseAmount: number;
  readonly rateBp: number;
  readonly amount: number;
}

export interface BondDetail {
  readonly id: string;
  readonly number: string;
  readonly status: CustomsBondStatus;
  readonly guaranteeAmount: number;
  readonly amountAtRisk: number;
  readonly guaranteeReference: string;
  readonly apurementReference: string | null;
  readonly apuredAt: Date | null;
}

export interface PaymentDetail {
  readonly id: string;
  readonly amount: number;
  readonly method: PaymentMethod;
  readonly paidAt: string;
  readonly reference: string | null;
  readonly createdAt: Date;
}

export interface DeclarationDetail extends DeclarationHeaderDetail {
  readonly lines: readonly DeclarationLineDetail[];
  readonly taxes: readonly DeclarationTaxDetail[];
  readonly bond: BondDetail | null;
  readonly payments: readonly PaymentDetail[];
  readonly apurement: DeclarationApurementProgress;
  readonly apurementEntries: readonly ApurementEntryDetail[];
}

export async function getDeclaration(
  db: Database,
  input: { readonly tenantId: string; readonly declarationId: string },
): Promise<DeclarationDetail | null> {
  const [header] = await db
    .select({
      id: customsDeclarations.id,
      number: customsDeclarations.number,
      status: customsDeclarations.status,
      declarationDate: customsDeclarations.declarationDate,
      externalReference: customsDeclarations.externalReference,
      freightAmount: customsDeclarations.freightAmount,
      insuranceAmount: customsDeclarations.insuranceAmount,
      cifTotal: customsDeclarations.cifTotal,
      dutyTotal: customsDeclarations.dutyTotal,
      taxTotal: customsDeclarations.taxTotal,
      grandTotal: customsDeclarations.grandTotal,
      paidTotal: customsDeclarations.paidTotal,
      liquidatedAt: customsDeclarations.liquidatedAt,
      clearedAt: customsDeclarations.clearedAt,
      cancelledAt: customsDeclarations.cancelledAt,
      createdAt: customsDeclarations.createdAt,
      regimeId: customsDeclarations.regimeId,
      regimeCode: customsRegimes.code,
      regimeLabel: customsRegimes.label,
      regimeKind: customsRegimes.kind,
      requiresBond: customsRegimes.requiresBond,
      requiresApurement: customsRegimes.requiresApurement,
      officeId: customsDeclarations.officeId,
      officeCode: customsOffices.code,
      officeName: customsOffices.name,
      partnerId: customsDeclarations.partnerId,
      partnerCode: partners.code,
      partnerName: partners.name,
    })
    .from(customsDeclarations)
    .innerJoin(
      customsRegimes,
      and(
        eq(customsRegimes.tenantId, customsDeclarations.tenantId),
        eq(customsRegimes.id, customsDeclarations.regimeId),
      ),
    )
    .innerJoin(
      customsOffices,
      and(
        eq(customsOffices.tenantId, customsDeclarations.tenantId),
        eq(customsOffices.id, customsDeclarations.officeId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, customsDeclarations.tenantId),
        eq(partners.id, customsDeclarations.partnerId),
      ),
    )
    .where(
      and(
        eq(customsDeclarations.tenantId, input.tenantId),
        eq(customsDeclarations.id, input.declarationId),
      ),
    )
    .limit(1);

  if (!header) {
    return null;
  }

  const [lines, taxes, bondRows, payments, apurementEntries] = await Promise.all([
    db
      .select({
        id: customsDeclarationLines.id,
        lineNumber: customsDeclarationLines.lineNumber,
        hsCode: customsDeclarationLines.hsCode,
        designation: customsDeclarationLines.designation,
        quantity: customsDeclarationLines.quantity,
        unitCode: customsDeclarationLines.unitCode,
        valueXof: customsDeclarationLines.valueXof,
        weightKg: customsDeclarationLines.weightKg,
        originCountry: customsDeclarationLines.originCountry,
        cifValue: customsDeclarationLines.cifValue,
        dutyRate: customsDeclarationLines.dutyRate,
        dutyAmount: customsDeclarationLines.dutyAmount,
      })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, input.tenantId),
          eq(customsDeclarationLines.declarationId, input.declarationId),
        ),
      )
      .orderBy(asc(customsDeclarationLines.lineNumber)),
    db
      .select({
        id: customsDeclarationTaxes.id,
        code: customsDeclarationTaxes.code,
        label: customsDeclarationTaxes.label,
        base: customsDeclarationTaxes.base,
        baseAmount: customsDeclarationTaxes.baseAmount,
        rateBp: customsDeclarationTaxes.rateBp,
        amount: customsDeclarationTaxes.amount,
      })
      .from(customsDeclarationTaxes)
      .where(
        and(
          eq(customsDeclarationTaxes.tenantId, input.tenantId),
          eq(customsDeclarationTaxes.declarationId, input.declarationId),
        ),
      )
      .orderBy(asc(customsDeclarationTaxes.position), asc(customsDeclarationTaxes.code)),
    db
      .select({
        id: customsBonds.id,
        number: customsBonds.number,
        status: customsBonds.status,
        guaranteeAmount: customsBonds.guaranteeAmount,
        amountAtRisk: customsBonds.amountAtRisk,
        guaranteeReference: customsBonds.guaranteeReference,
        apurementReference: customsBonds.apurementReference,
        apuredAt: customsBonds.apuredAt,
      })
      .from(customsBonds)
      .where(
        and(
          eq(customsBonds.tenantId, input.tenantId),
          eq(customsBonds.declarationId, input.declarationId),
        ),
      )
      .limit(1),
    db
      .select({
        id: customsPayments.id,
        amount: customsPayments.amount,
        method: customsPayments.method,
        paidAt: customsPayments.paidAt,
        reference: customsPayments.reference,
        createdAt: customsPayments.createdAt,
      })
      .from(customsPayments)
      .where(
        and(
          eq(customsPayments.tenantId, input.tenantId),
          eq(customsPayments.declarationId, input.declarationId),
        ),
      )
      .orderBy(asc(customsPayments.paidAt), asc(customsPayments.createdAt)),
    db
      .select({
        id: customsApurements.id,
        lineId: customsApurements.lineId,
        lineNumber: customsDeclarationLines.lineNumber,
        quantity: customsApurements.quantity,
        apuredAt: customsApurements.apuredAt,
        mode: customsApurements.mode,
        reference: customsApurements.reference,
        createdAt: customsApurements.createdAt,
        createdByName: users.name,
      })
      .from(customsApurements)
      .innerJoin(
        customsDeclarationLines,
        and(
          eq(customsDeclarationLines.tenantId, customsApurements.tenantId),
          eq(customsDeclarationLines.declarationId, customsApurements.declarationId),
          eq(customsDeclarationLines.id, customsApurements.lineId),
        ),
      )
      .leftJoin(users, eq(users.id, customsApurements.createdByUserId))
      .where(
        and(
          eq(customsApurements.tenantId, input.tenantId),
          eq(customsApurements.declarationId, input.declarationId),
        ),
      )
      .orderBy(
        asc(customsDeclarationLines.lineNumber),
        asc(customsApurements.apuredAt),
        asc(customsApurements.createdAt),
      ),
  ]);

  const apuredByLine = new Map<string, bigint>();
  for (const entry of apurementEntries) {
    apuredByLine.set(
      entry.lineId,
      (apuredByLine.get(entry.lineId) ?? 0n) + quantityToMicros(entry.quantity),
    );
  }
  const detailedLines: DeclarationLineDetail[] = lines.map((line) => {
    const progress = lineApurementProgress(
      line.quantity,
      microsToQuantity(apuredByLine.get(line.id) ?? 0n),
    );
    return {
      ...line,
      apuredQuantity: progress.apuredQuantity,
      remainingQuantity: progress.remainingQuantity,
      apurementRateBp: progress.rateBp,
      apurementState: progress.state,
    };
  });

  return {
    ...header,
    lines: detailedLines,
    taxes,
    bond: bondRows[0] ?? null,
    payments,
    apurementEntries,
    apurement: declarationApurementProgress(
      detailedLines.map((line) => ({
        quantity: line.quantity,
        apuredQuantity: line.apuredQuantity,
        unitCode: line.unitCode,
      })),
      header.requiresApurement,
    ),
  };
}

async function assertActiveReferentials(
  tx: Transaction,
  tenantId: string,
  data: { regimeId: string; officeId: string; partnerId: string },
): Promise<void> {
  const [regime] = await tx
    .select({ active: customsRegimes.active })
    .from(customsRegimes)
    .where(and(eq(customsRegimes.tenantId, tenantId), eq(customsRegimes.id, data.regimeId)))
    .limit(1);
  if (!regime) {
    throw new CustomsError("Régime introuvable dans cet espace.");
  }
  if (!regime.active) {
    throw new CustomsError("Le régime choisi est désactivé.");
  }

  const [office] = await tx
    .select({ active: customsOffices.active })
    .from(customsOffices)
    .where(and(eq(customsOffices.tenantId, tenantId), eq(customsOffices.id, data.officeId)))
    .limit(1);
  if (!office) {
    throw new CustomsError("Bureau introuvable dans cet espace.");
  }
  if (!office.active) {
    throw new CustomsError("Le bureau choisi est désactivé.");
  }

  const [partner] = await tx
    .select({ active: partners.active })
    .from(partners)
    .where(and(eq(partners.tenantId, tenantId), eq(partners.id, data.partnerId)))
    .limit(1);
  if (!partner) {
    throw new CustomsError("Tiers déclaré introuvable dans cet espace.");
  }
  if (!partner.active) {
    throw new CustomsError("Le tiers déclaré est inactif.");
  }
}

export async function createDeclaration(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly raw: {
      regimeId: unknown;
      officeId: unknown;
      partnerId: unknown;
      declarationDate: unknown;
      externalReference: unknown;
      freightAmountXof: unknown;
      insuranceAmountXof: unknown;
    };
  },
): Promise<{ id: string; number: string }> {
  const data = assertValid(validateDeclarationHeader(input.raw), "Déclaration invalide.");
  return db.transaction(async (tx) => {
    await assertActiveReferentials(tx, input.tenantId, data);
    const number = await nextDocumentNumber(tx, {
      tenantId: input.tenantId,
      scope: "customs_declaration",
      date: data.declarationDate,
    });
    const [created] = await tx
      .insert(customsDeclarations)
      .values({
        tenantId: input.tenantId,
        number,
        regimeId: data.regimeId,
        officeId: data.officeId,
        partnerId: data.partnerId,
        declarationDate: data.declarationDate,
        externalReference: data.externalReference,
        freightAmount: data.freightAmountXof,
        insuranceAmount: data.insuranceAmountXof,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: customsDeclarations.id });
    if (!created) {
      throw new CustomsError("La déclaration n'a pas pu être créée.");
    }
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.declaration.create",
      entityType: "customs_declaration",
      entityId: created.id,
      details: {
        number,
        regimeId: data.regimeId,
        officeId: data.officeId,
        partnerId: data.partnerId,
        declarationDate: data.declarationDate,
      },
    });
    return { id: created.id, number };
  });
}

export async function updateDeclarationHeader(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly declarationId: string;
    readonly raw: {
      regimeId: unknown;
      officeId: unknown;
      partnerId: unknown;
      declarationDate: unknown;
      externalReference: unknown;
      freightAmountXof: unknown;
      insuranceAmountXof: unknown;
    };
  },
): Promise<void> {
  const data = assertValid(validateDeclarationHeader(input.raw), "Déclaration invalide.");
  await db.transaction(async (tx) => {
    const [declaration] = await tx
      .select()
      .from(customsDeclarations)
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable dans cet espace.");
    }
    if (declaration.status !== "draft") {
      throw new CustomsError("Seule une déclaration en brouillon peut être modifiée.");
    }
    await assertActiveReferentials(tx, input.tenantId, data);
    await tx
      .update(customsDeclarations)
      .set({
        regimeId: data.regimeId,
        officeId: data.officeId,
        partnerId: data.partnerId,
        declarationDate: data.declarationDate,
        externalReference: data.externalReference,
        freightAmount: data.freightAmountXof,
        insuranceAmount: data.insuranceAmountXof,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.declaration.update",
      entityType: "customs_declaration",
      entityId: declaration.id,
      details: {
        before: {
          regimeId: declaration.regimeId,
          officeId: declaration.officeId,
          partnerId: declaration.partnerId,
          declarationDate: declaration.declarationDate,
          externalReference: declaration.externalReference,
          freightAmount: declaration.freightAmount,
          insuranceAmount: declaration.insuranceAmount,
        },
        after: {
          regimeId: data.regimeId,
          officeId: data.officeId,
          partnerId: data.partnerId,
          declarationDate: data.declarationDate,
          externalReference: data.externalReference,
          freightAmount: data.freightAmountXof,
          insuranceAmount: data.insuranceAmountXof,
        },
      },
    });
  });
}

export async function addDeclarationLine(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly declarationId: string;
    readonly raw: {
      hsCode: unknown;
      designation: unknown;
      quantity: unknown;
      unitCode: unknown;
      valueXof: unknown;
      weightKg: unknown;
      originCountry: unknown;
    };
  },
): Promise<{ id: string; lineNumber: number }> {
  const data = assertValid(validateDeclarationLine(input.raw), "Ligne invalide.");
  return db.transaction(async (tx) => {
    const [declaration] = await tx
      .select({ id: customsDeclarations.id, status: customsDeclarations.status })
      .from(customsDeclarations)
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable dans cet espace.");
    }
    if (declaration.status !== "draft") {
      throw new CustomsError(
        "Des lignes ne peuvent être ajoutées qu'à une déclaration en brouillon.",
      );
    }
    const [hsCode] = await tx
      .select({ id: hsCodes.id })
      .from(hsCodes)
      .where(and(eq(hsCodes.tenantId, input.tenantId), eq(hsCodes.code, data.hsCode)))
      .limit(1);
    if (!hsCode) {
      throw new CustomsError(
        `Code SH ${data.hsCode} introuvable dans la nomenclature : importez-le ou créez-le d'abord.`,
      );
    }
    const [last] = await tx
      .select({ value: sql<number>`coalesce(max(${customsDeclarationLines.lineNumber}), 0)` })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, input.tenantId),
          eq(customsDeclarationLines.declarationId, input.declarationId),
        ),
      );
    const lineNumber = Number(last?.value ?? 0) + 1;
    const [created] = await tx
      .insert(customsDeclarationLines)
      .values({
        tenantId: input.tenantId,
        declarationId: input.declarationId,
        lineNumber,
        hsCodeId: hsCode.id,
        hsCode: data.hsCode,
        designation: data.designation,
        quantity: data.quantity,
        unitCode: data.unitCode,
        valueXof: data.valueXof,
        weightKg: data.weightKg,
        originCountry: data.originCountry,
      })
      .returning({ id: customsDeclarationLines.id });
    if (!created) {
      throw new CustomsError("La ligne n'a pas pu être enregistrée.");
    }
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.line.add",
      entityType: "customs_declaration",
      entityId: input.declarationId,
      details: {
        lineNumber,
        hsCode: data.hsCode,
        designation: data.designation,
        valueXof: data.valueXof,
      },
    });
    return { id: created.id, lineNumber };
  });
}

export async function removeDeclarationLine(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly declarationId: string;
    readonly lineId: string;
  },
): Promise<void> {
  await db.transaction(async (tx) => {
    const [declaration] = await tx
      .select({ id: customsDeclarations.id, status: customsDeclarations.status })
      .from(customsDeclarations)
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable dans cet espace.");
    }
    if (declaration.status !== "draft") {
      throw new CustomsError("Une ligne ne peut être retirée que d'une déclaration en brouillon.");
    }
    const [line] = await tx
      .select({
        id: customsDeclarationLines.id,
        lineNumber: customsDeclarationLines.lineNumber,
        hsCode: customsDeclarationLines.hsCode,
      })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, input.tenantId),
          eq(customsDeclarationLines.id, input.lineId),
          eq(customsDeclarationLines.declarationId, input.declarationId),
        ),
      )
      .limit(1);
    if (!line) {
      throw new CustomsError("Ligne introuvable sur cette déclaration.");
    }
    await tx
      .delete(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, input.tenantId),
          eq(customsDeclarationLines.id, input.lineId),
        ),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.line.remove",
      entityType: "customs_declaration",
      entityId: input.declarationId,
      details: { lineNumber: line.lineNumber, hsCode: line.hsCode },
    });
  });
}

async function declarationBondStatus(
  tx: Transaction,
  tenantId: string,
  declarationId: string,
): Promise<CustomsBondStatus | null> {
  const [bond] = await tx
    .select({ status: customsBonds.status })
    .from(customsBonds)
    .where(and(eq(customsBonds.tenantId, tenantId), eq(customsBonds.declarationId, declarationId)))
    .limit(1);
  return bond?.status ?? null;
}

async function declarationHasApurement(
  tx: Transaction,
  tenantId: string,
  declarationId: string,
): Promise<boolean> {
  const [entry] = await tx
    .select({ id: customsApurements.id })
    .from(customsApurements)
    .where(
      and(
        eq(customsApurements.tenantId, tenantId),
        eq(customsApurements.declarationId, declarationId),
      ),
    )
    .limit(1);
  return entry !== undefined;
}

export async function changeDeclarationStatus(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly declarationId: string;
    readonly transition: DeclarationTransition;
  },
): Promise<{ status: CustomsDeclarationStatus }> {
  return db.transaction(async (tx) => {
    const [declaration] = await tx
      .select({
        id: customsDeclarations.id,
        status: customsDeclarations.status,
        freightAmount: customsDeclarations.freightAmount,
        insuranceAmount: customsDeclarations.insuranceAmount,
        paidTotal: customsDeclarations.paidTotal,
        grandTotal: customsDeclarations.grandTotal,
        requiresBond: customsRegimes.requiresBond,
      })
      .from(customsDeclarations)
      .innerJoin(
        customsRegimes,
        and(
          eq(customsRegimes.tenantId, customsDeclarations.tenantId),
          eq(customsRegimes.id, customsDeclarations.regimeId),
        ),
      )
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable dans cet espace.");
    }

    const error = transitionError(declaration.status, input.transition);
    if (error) {
      throw new CustomsError(error);
    }

    const now = new Date();
    let status: CustomsDeclarationStatus;

    if (input.transition === "deposit") {
      const [lineCount] = await tx
        .select({ value: count() })
        .from(customsDeclarationLines)
        .where(
          and(
            eq(customsDeclarationLines.tenantId, input.tenantId),
            eq(customsDeclarationLines.declarationId, input.declarationId),
          ),
        );
      if ((lineCount?.value ?? 0) === 0) {
        throw new CustomsError("Dépôt refusé : ajoutez au moins une ligne à la déclaration.");
      }
      status = "deposited";
      await tx
        .update(customsDeclarations)
        .set({ status, updatedAt: now })
        .where(
          and(
            eq(customsDeclarations.tenantId, input.tenantId),
            eq(customsDeclarations.id, input.declarationId),
          ),
        );
    } else if (input.transition === "liquidate") {
      const lines = await tx
        .select({
          lineNumber: customsDeclarationLines.lineNumber,
          valueXof: customsDeclarationLines.valueXof,
          tecRate: hsCodes.tecRate,
        })
        .from(customsDeclarationLines)
        .innerJoin(
          hsCodes,
          and(
            eq(hsCodes.tenantId, customsDeclarationLines.tenantId),
            eq(hsCodes.id, customsDeclarationLines.hsCodeId),
          ),
        )
        .where(
          and(
            eq(customsDeclarationLines.tenantId, input.tenantId),
            eq(customsDeclarationLines.declarationId, input.declarationId),
          ),
        )
        .orderBy(asc(customsDeclarationLines.lineNumber));
      const taxes = await tx
        .select({
          code: customsTaxes.code,
          label: customsTaxes.label,
          base: customsTaxes.base,
          rateBp: customsTaxes.rateBp,
          position: customsTaxes.position,
        })
        .from(customsTaxes)
        .where(and(eq(customsTaxes.tenantId, input.tenantId), eq(customsTaxes.active, true)))
        .orderBy(asc(customsTaxes.position), asc(customsTaxes.code));

      const result = liquidateDeclaration({
        freightAmountXof: declaration.freightAmount,
        insuranceAmountXof: declaration.insuranceAmount,
        lines,
        taxes,
      });

      for (const line of result.lines) {
        await tx
          .update(customsDeclarationLines)
          .set({
            cifValue: line.cifValue,
            dutyRate: line.dutyRate,
            dutyAmount: line.dutyAmount,
            updatedAt: now,
          })
          .where(
            and(
              eq(customsDeclarationLines.tenantId, input.tenantId),
              eq(customsDeclarationLines.declarationId, input.declarationId),
              eq(customsDeclarationLines.lineNumber, line.lineNumber),
            ),
          );
      }

      await tx
        .delete(customsDeclarationTaxes)
        .where(
          and(
            eq(customsDeclarationTaxes.tenantId, input.tenantId),
            eq(customsDeclarationTaxes.declarationId, input.declarationId),
          ),
        );
      if (result.taxes.length > 0) {
        await tx.insert(customsDeclarationTaxes).values(
          result.taxes.map((tax) => ({
            tenantId: input.tenantId,
            declarationId: input.declarationId,
            code: tax.code,
            label: tax.label,
            base: tax.base,
            baseAmount: tax.baseAmount,
            rateBp: tax.rateBp,
            amount: tax.amount,
            position: tax.position,
          })),
        );
      }

      status = "liquidated";
      await tx
        .update(customsDeclarations)
        .set({
          status,
          cifTotal: result.cifTotal,
          dutyTotal: result.dutyTotal,
          taxTotal: result.taxTotal,
          grandTotal: result.grandTotal,
          liquidatedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(customsDeclarations.tenantId, input.tenantId),
            eq(customsDeclarations.id, input.declarationId),
          ),
        );
    } else if (input.transition === "clear") {
      const bondStatus = await declarationBondStatus(tx, input.tenantId, input.declarationId);
      const clearError = clearingContextError({
        paidTotal: declaration.paidTotal,
        grandTotal: declaration.grandTotal,
        requiresBond: declaration.requiresBond,
        bondStatus,
      });
      if (clearError) {
        throw new CustomsError(clearError);
      }
      status = "cleared";
      await tx
        .update(customsDeclarations)
        .set({ status, clearedAt: now, updatedAt: now })
        .where(
          and(
            eq(customsDeclarations.tenantId, input.tenantId),
            eq(customsDeclarations.id, input.declarationId),
          ),
        );
    } else {
      const bondStatus = await declarationBondStatus(tx, input.tenantId, input.declarationId);
      const hasApurement = await declarationHasApurement(tx, input.tenantId, input.declarationId);
      const cancelError = cancellationContextError({
        paidTotal: declaration.paidTotal,
        hasOpenBond: bondStatus === "open",
        hasApurement,
      });
      if (cancelError) {
        throw new CustomsError(cancelError);
      }
      status = "cancelled";
      await tx
        .update(customsDeclarations)
        .set({ status, cancelledAt: now, updatedAt: now })
        .where(
          and(
            eq(customsDeclarations.tenantId, input.tenantId),
            eq(customsDeclarations.id, input.declarationId),
          ),
        );
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.declaration.status",
      entityType: "customs_declaration",
      entityId: declaration.id,
      details: { from: declaration.status, to: status, transition: input.transition },
    });

    return { status };
  });
}

export interface BondSummary {
  readonly id: string;
  readonly number: string;
  readonly status: CustomsBondStatus;
  readonly guaranteeAmount: number;
  readonly amountAtRisk: number;
  readonly guaranteeReference: string;
  readonly apurementReference: string | null;
  readonly apuredAt: Date | null;
  readonly declarationId: string;
  readonly declarationNumber: string;
  readonly declarationStatus: CustomsDeclarationStatus;
  readonly partnerName: string;
}

export async function listBonds(db: Database, tenantId: string): Promise<readonly BondSummary[]> {
  return db
    .select({
      id: customsBonds.id,
      number: customsBonds.number,
      status: customsBonds.status,
      guaranteeAmount: customsBonds.guaranteeAmount,
      amountAtRisk: customsBonds.amountAtRisk,
      guaranteeReference: customsBonds.guaranteeReference,
      apurementReference: customsBonds.apurementReference,
      apuredAt: customsBonds.apuredAt,
      declarationId: customsBonds.declarationId,
      declarationNumber: customsDeclarations.number,
      declarationStatus: customsDeclarations.status,
      partnerName: partners.name,
    })
    .from(customsBonds)
    .innerJoin(
      customsDeclarations,
      and(
        eq(customsDeclarations.tenantId, customsBonds.tenantId),
        eq(customsDeclarations.id, customsBonds.declarationId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, customsDeclarations.tenantId),
        eq(partners.id, customsDeclarations.partnerId),
      ),
    )
    .where(eq(customsBonds.tenantId, tenantId))
    .orderBy(
      sql`case when ${customsBonds.status} = 'open' then 0 else 1 end`,
      desc(customsBonds.createdAt),
    );
}

export async function createBond(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly declarationId: string;
    readonly raw: { guaranteeAmountXof: unknown; guaranteeReference: unknown };
  },
): Promise<{ id: string; number: string }> {
  const data = assertValid(validateBondInput(input.raw), "Acquit invalide.");
  return db.transaction(async (tx) => {
    const [declaration] = await tx
      .select({
        id: customsDeclarations.id,
        status: customsDeclarations.status,
        grandTotal: customsDeclarations.grandTotal,
        requiresBond: customsRegimes.requiresBond,
      })
      .from(customsDeclarations)
      .innerJoin(
        customsRegimes,
        and(
          eq(customsRegimes.tenantId, customsDeclarations.tenantId),
          eq(customsRegimes.id, customsDeclarations.regimeId),
        ),
      )
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable dans cet espace.");
    }
    if (!declaration.requiresBond) {
      throw new CustomsError("Ce régime ne prévoit pas d'acquit-à-caution.");
    }
    if (declaration.status !== "liquidated") {
      throw new CustomsError("Un acquit ne peut être ouvert qu'après la liquidation.");
    }
    const [existing] = await tx
      .select({ id: customsBonds.id })
      .from(customsBonds)
      .where(
        and(
          eq(customsBonds.tenantId, input.tenantId),
          eq(customsBonds.declarationId, input.declarationId),
        ),
      )
      .limit(1);
    if (existing) {
      throw new CustomsError("Un acquit-à-caution existe déjà pour cette déclaration.");
    }
    if (data.guaranteeAmountXof < declaration.grandTotal) {
      throw new CustomsError(
        `Garantie insuffisante : ${data.guaranteeAmountXof.toLocaleString("fr-FR")} XOF pour un montant à payer de ${declaration.grandTotal.toLocaleString("fr-FR")} XOF.`,
      );
    }
    const number = await nextDocumentNumber(tx, {
      tenantId: input.tenantId,
      scope: "customs_bond",
    });
    const [created] = await tx
      .insert(customsBonds)
      .values({
        tenantId: input.tenantId,
        number,
        declarationId: input.declarationId,
        guaranteeAmount: data.guaranteeAmountXof,
        guaranteeReference: data.guaranteeReference,
        amountAtRisk: declaration.grandTotal,
        openedByUserId: input.actorUserId,
      })
      .returning({ id: customsBonds.id });
    if (!created) {
      throw new CustomsError("L'acquit n'a pas pu être ouvert.");
    }
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.bond.create",
      entityType: "customs_bond",
      entityId: created.id,
      details: {
        number,
        declarationId: input.declarationId,
        guaranteeAmount: data.guaranteeAmountXof,
        amountAtRisk: declaration.grandTotal,
      },
    });
    return { id: created.id, number };
  });
}

export async function apureBond(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly bondId: string;
    readonly raw: { reference: unknown };
  },
): Promise<void> {
  const reference = validateApurementReference(input.raw.reference);
  if (!reference.value || reference.errors.length > 0) {
    throw new CustomsError(reference.errors[0] ?? "Référence d'apurement obligatoire.");
  }
  await db.transaction(async (tx) => {
    const [bond] = await tx
      .select({
        id: customsBonds.id,
        number: customsBonds.number,
        status: customsBonds.status,
        declarationId: customsBonds.declarationId,
      })
      .from(customsBonds)
      .where(and(eq(customsBonds.tenantId, input.tenantId), eq(customsBonds.id, input.bondId)))
      .limit(1)
      .for("update");
    if (!bond) {
      throw new CustomsError("Acquit introuvable dans cet espace.");
    }
    if (bond.status === "apured") {
      throw new CustomsError("Cet acquit est déjà apuré.");
    }
    const now = new Date();
    await tx
      .update(customsBonds)
      .set({
        status: "apured",
        apuredAt: now,
        apuredByUserId: input.actorUserId,
        apurementReference: reference.value,
        updatedAt: now,
      })
      .where(and(eq(customsBonds.tenantId, input.tenantId), eq(customsBonds.id, input.bondId)));
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.bond.apure",
      entityType: "customs_bond",
      entityId: bond.id,
      details: {
        number: bond.number,
        declarationId: bond.declarationId,
        reference: reference.value,
      },
    });
  });
}

export async function recordCustomsPayment(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly declarationId: string;
    readonly raw: {
      amountXof: unknown;
      method: unknown;
      paidDate: unknown;
      reference: unknown;
    };
  },
): Promise<{ id: string }> {
  const data = assertValid(validatePaymentInput(input.raw), "Paiement invalide.");
  return db.transaction(async (tx) => {
    const [declaration] = await tx
      .select({
        id: customsDeclarations.id,
        status: customsDeclarations.status,
        grandTotal: customsDeclarations.grandTotal,
        paidTotal: customsDeclarations.paidTotal,
      })
      .from(customsDeclarations)
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable dans cet espace.");
    }
    if (declaration.status !== "liquidated") {
      throw new CustomsError(
        "Un paiement ne peut être enregistré que sur une déclaration liquidée.",
      );
    }
    const remaining = declaration.grandTotal - declaration.paidTotal;
    if (data.amountXof > remaining) {
      throw new CustomsError(
        `Paiement refusé : ${data.amountXof.toLocaleString("fr-FR")} XOF dépasse le reste dû de ${remaining.toLocaleString("fr-FR")} XOF.`,
      );
    }
    const [created] = await tx
      .insert(customsPayments)
      .values({
        tenantId: input.tenantId,
        declarationId: input.declarationId,
        amount: data.amountXof,
        method: data.method,
        paidAt: data.paidDate,
        reference: data.reference,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: customsPayments.id });
    if (!created) {
      throw new CustomsError("Le paiement n'a pas pu être enregistré.");
    }
    await tx
      .update(customsDeclarations)
      .set({ paidTotal: declaration.paidTotal + data.amountXof, updatedAt: new Date() })
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      );
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.payment.create",
      entityType: "customs_declaration",
      entityId: input.declarationId,
      details: {
        amount: data.amountXof,
        method: data.method,
        paidAt: data.paidDate,
        reference: data.reference,
      },
    });
    return created;
  });
}

export async function recordApurement(
  db: Database,
  input: {
    readonly tenantId: string;
    readonly actorUserId: string;
    readonly declarationId: string;
    readonly raw: {
      lineId: unknown;
      quantity: unknown;
      apuredDate: unknown;
      mode: unknown;
      reference: unknown;
    };
  },
): Promise<{ id: string }> {
  const data = assertValid(validateApurementEntryInput(input.raw), "Apurement invalide.");
  return db.transaction(async (tx) => {
    const [declaration] = await tx
      .select({
        id: customsDeclarations.id,
        status: customsDeclarations.status,
        requiresApurement: customsRegimes.requiresApurement,
      })
      .from(customsDeclarations)
      .innerJoin(
        customsRegimes,
        and(
          eq(customsRegimes.tenantId, customsDeclarations.tenantId),
          eq(customsRegimes.id, customsDeclarations.regimeId),
        ),
      )
      .where(
        and(
          eq(customsDeclarations.tenantId, input.tenantId),
          eq(customsDeclarations.id, input.declarationId),
        ),
      )
      .limit(1)
      .for("update");
    if (!declaration) {
      throw new CustomsError("Déclaration introuvable dans cet espace.");
    }
    const [line] = await tx
      .select({
        id: customsDeclarationLines.id,
        lineNumber: customsDeclarationLines.lineNumber,
        quantity: customsDeclarationLines.quantity,
        unitCode: customsDeclarationLines.unitCode,
      })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, input.tenantId),
          eq(customsDeclarationLines.declarationId, input.declarationId),
          eq(customsDeclarationLines.id, data.lineId),
        ),
      )
      .limit(1);
    if (!line) {
      throw new CustomsError("Ligne introuvable sur cette déclaration.");
    }
    const [apured] = await tx
      .select({
        value: sql<string>`coalesce(sum(${customsApurements.quantity}), 0)`,
      })
      .from(customsApurements)
      .where(
        and(
          eq(customsApurements.tenantId, input.tenantId),
          eq(customsApurements.declarationId, input.declarationId),
          eq(customsApurements.lineId, data.lineId),
        ),
      );
    const lineError = apurementContextError({
      requiresApurement: declaration.requiresApurement,
      status: declaration.status,
      lineQuantity: line.quantity,
      apuredQuantity: apured?.value ? String(apured.value) : "0",
      requestedQuantity: data.quantity,
      unitCode: line.unitCode,
    });
    if (lineError) {
      throw new CustomsError(lineError);
    }
    const [created] = await tx
      .insert(customsApurements)
      .values({
        tenantId: input.tenantId,
        declarationId: input.declarationId,
        lineId: data.lineId,
        quantity: data.quantity,
        apuredAt: data.apuredDate,
        mode: data.mode,
        reference: data.reference,
        createdByUserId: input.actorUserId,
      })
      .returning({ id: customsApurements.id });
    if (!created) {
      throw new CustomsError("L'apurement n'a pas pu être enregistré.");
    }
    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "customs.apurement.create",
      entityType: "customs_apurement",
      entityId: created.id,
      details: {
        declarationId: input.declarationId,
        lineId: data.lineId,
        lineNumber: line.lineNumber,
        quantity: data.quantity,
        apuredAt: data.apuredDate,
        mode: data.mode,
        reference: data.reference,
      },
    });
    return created;
  });
}

export interface ApurementOverviewRow {
  readonly id: string;
  readonly number: string;
  readonly status: CustomsDeclarationStatus;
  readonly declarationDate: string;
  readonly regimeCode: string;
  readonly regimeLabel: string;
  readonly partnerName: string;
  readonly grandTotal: number;
  readonly paidTotal: number;
  readonly progress: DeclarationApurementProgress;
}

export async function listApurementOverviews(
  db: Database,
  tenantId: string,
): Promise<readonly ApurementOverviewRow[]> {
  const rows = await db
    .select({
      id: customsDeclarations.id,
      number: customsDeclarations.number,
      status: customsDeclarations.status,
      declarationDate: customsDeclarations.declarationDate,
      regimeCode: customsRegimes.code,
      regimeLabel: customsRegimes.label,
      partnerName: partners.name,
      grandTotal: customsDeclarations.grandTotal,
      paidTotal: customsDeclarations.paidTotal,
    })
    .from(customsDeclarations)
    .innerJoin(
      customsRegimes,
      and(
        eq(customsRegimes.tenantId, customsDeclarations.tenantId),
        eq(customsRegimes.id, customsDeclarations.regimeId),
      ),
    )
    .innerJoin(
      partners,
      and(
        eq(partners.tenantId, customsDeclarations.tenantId),
        eq(partners.id, customsDeclarations.partnerId),
      ),
    )
    .where(
      and(
        eq(customsDeclarations.tenantId, tenantId),
        eq(customsRegimes.requiresApurement, true),
        inArray(customsDeclarations.status, ["liquidated", "cleared"]),
      ),
    )
    .orderBy(desc(customsDeclarations.declarationDate), desc(customsDeclarations.createdAt))
    .limit(CUSTOMS_LIST_LIMIT);

  if (rows.length === 0) {
    return [];
  }

  const declarationIds = rows.map((row) => row.id);
  const [lineRows, apurementRows] = await Promise.all([
    db
      .select({
        id: customsDeclarationLines.id,
        declarationId: customsDeclarationLines.declarationId,
        quantity: customsDeclarationLines.quantity,
        unitCode: customsDeclarationLines.unitCode,
      })
      .from(customsDeclarationLines)
      .where(
        and(
          eq(customsDeclarationLines.tenantId, tenantId),
          inArray(customsDeclarationLines.declarationId, declarationIds),
        ),
      ),
    db
      .select({
        declarationId: customsApurements.declarationId,
        lineId: customsApurements.lineId,
        quantity: customsApurements.quantity,
      })
      .from(customsApurements)
      .where(
        and(
          eq(customsApurements.tenantId, tenantId),
          inArray(customsApurements.declarationId, declarationIds),
        ),
      ),
  ]);

  const apuredByLine = new Map<string, bigint>();
  for (const entry of apurementRows) {
    const key = `${entry.declarationId}:${entry.lineId}`;
    apuredByLine.set(key, (apuredByLine.get(key) ?? 0n) + quantityToMicros(entry.quantity));
  }

  const linesByDeclaration = new Map<
    string,
    { quantity: string; apuredQuantity: string; unitCode: string }[]
  >();
  for (const line of lineRows) {
    const apured = apuredByLine.get(`${line.declarationId}:${line.id}`) ?? 0n;
    const progress = lineApurementProgress(line.quantity, microsToQuantity(apured));
    const list = linesByDeclaration.get(line.declarationId) ?? [];
    list.push({
      quantity: line.quantity,
      apuredQuantity: progress.apuredQuantity,
      unitCode: line.unitCode,
    });
    linesByDeclaration.set(line.declarationId, list);
  }

  return rows.map((row) => ({
    ...row,
    progress: declarationApurementProgress(linesByDeclaration.get(row.id) ?? [], true),
  }));
}
