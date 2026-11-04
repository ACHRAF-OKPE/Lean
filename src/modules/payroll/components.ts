import { and, asc, eq } from "drizzle-orm";
import type { Database } from "@/db/client";
import { auditEvents, payrollComponents, type PayrollComponentKind } from "@/db/schema";
import {
  MAX_COMPONENT_AMOUNT_XOF,
  MAX_CONTRIBUTION_RATE,
  MAX_PAYROLL_COMPONENT_LABEL_LENGTH,
  PAYROLL_COMPONENT_CODE_PATTERN,
  PAYROLL_RATE_SCALE,
} from "./constants";
import { PayrollError } from "./errors";

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export interface PayrollComponentView {
  readonly id: string;
  readonly code: string;
  readonly label: string;
  readonly kind: PayrollComponentKind;
  readonly mode: "fixed" | "percent";
  readonly amountXof: number;
  readonly ratePercent: string;
  readonly taxable: boolean;
  readonly active: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

function normalizeCode(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, "_");
}

function validateCode(code: string): void {
  if (!PAYROLL_COMPONENT_CODE_PATTERN.test(code)) {
    throw new PayrollError(
      "Code de la rubrique : 2 à 16 caractères, majuscules, chiffres et tirets bas, commençant par une lettre ou un chiffre.",
    );
  }
}

function validateLabel(label: string): void {
  if (label.length === 0 || label.length > MAX_PAYROLL_COMPONENT_LABEL_LENGTH) {
    throw new PayrollError(
      `Libellé de la rubrique : 1 à ${MAX_PAYROLL_COMPONENT_LABEL_LENGTH} caractères.`,
    );
  }
}

function parseAmountXof(raw: unknown, label: string): number {
  const text = String(raw ?? "")
    .trim()
    .replace(/\s/g, "");
  const normalized = text === "" ? "0" : text;
  if (!/^\d+$/.test(normalized)) {
    throw new PayrollError(`${label} : montant entier en francs attendu, sans décimale.`);
  }
  const value = Number(normalized);
  if (value > MAX_COMPONENT_AMOUNT_XOF) {
    throw new PayrollError(`${label} : ${MAX_COMPONENT_AMOUNT_XOF} XOF maximum.`);
  }
  return value;
}

function parseRate(raw: unknown, label: string): string {
  let text = String(raw ?? "").trim();
  if (text === "") {
    text = "0";
  }
  if (text.includes(",") && !text.includes(".")) {
    text = text.replace(",", ".");
  }
  const match = /^(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) {
    throw new PayrollError(`${label} : taux entre 0 et ${MAX_CONTRIBUTION_RATE}, point décimal.`);
  }
  const fraction = match[2] ?? "";
  if (fraction.length > PAYROLL_RATE_SCALE) {
    throw new PayrollError(`${label} : ${PAYROLL_RATE_SCALE} décimales maximum.`);
  }
  const whole = match[1]!.replace(/^0+(?=\d)/, "");
  const value = Number(`${whole || "0"}.${fraction || "0"}`);
  if (value > MAX_CONTRIBUTION_RATE) {
    throw new PayrollError(`${label} : taux entre 0 et ${MAX_CONTRIBUTION_RATE}.`);
  }
  const trimmed = fraction.replace(/0+$/, "");
  return `${whole || "0"}${trimmed ? `.${trimmed}` : ""}`;
}

function textOf(raw: unknown): string {
  return raw === null || raw === undefined ? "" : String(raw).trim();
}

function checkboxOf(raw: unknown): boolean {
  return raw === true || raw === "true" || raw === "on" || raw === "1";
}

async function assertCodeAvailable(
  tx: Transaction,
  tenantId: string,
  code: string,
  excludeId?: string,
): Promise<void> {
  const [existing] = await tx
    .select({ id: payrollComponents.id })
    .from(payrollComponents)
    .where(and(eq(payrollComponents.tenantId, tenantId), eq(payrollComponents.code, code)))
    .limit(1);
  if (existing && existing.id !== excludeId) {
    throw new PayrollError(`Le code ${code} est déjà utilisé par une autre rubrique.`);
  }
}

/** PAY-003 — le registre des rubriques liste gains et retenues, actifs et inactifs, triés par code. */
export async function listPayrollComponents(
  db: Database,
  tenantId: string,
): Promise<readonly PayrollComponentView[]> {
  const rows = await db
    .select({
      id: payrollComponents.id,
      code: payrollComponents.code,
      label: payrollComponents.label,
      kind: payrollComponents.kind,
      mode: payrollComponents.mode,
      amountXof: payrollComponents.amountXof,
      ratePercent: payrollComponents.ratePercent,
      taxable: payrollComponents.taxable,
      active: payrollComponents.active,
      createdAt: payrollComponents.createdAt,
      updatedAt: payrollComponents.updatedAt,
    })
    .from(payrollComponents)
    .where(eq(payrollComponents.tenantId, tenantId))
    .orderBy(asc(payrollComponents.code));

  return rows.map((row) => ({ ...row, ratePercent: normalizeRate(row.ratePercent) }));
}

function normalizeRate(value: string): string {
  const [whole = "0", fraction = ""] = value.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${whole}.${trimmed}` : whole;
}

export interface CreatePayrollComponentInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly raw: {
    readonly code: unknown;
    readonly label: unknown;
    readonly kind: unknown;
    readonly mode: unknown;
    readonly amountXof: unknown;
    readonly ratePercent: unknown;
    readonly taxable: unknown;
  };
}

/** PAY-003 — une rubrique de paie se crée active, code unique dans l'espace. */
export async function createPayrollComponent(
  db: Database,
  input: CreatePayrollComponentInput,
): Promise<{ id: string }> {
  const code = normalizeCode(input.raw.code);
  const label = textOf(input.raw.label);
  const kind = textOf(input.raw.kind);
  const mode = textOf(input.raw.mode);
  validateCode(code);
  validateLabel(label);
  if (kind !== "earning" && kind !== "deduction") {
    throw new PayrollError("Type de rubrique : gain ou retenue attendu.");
  }
  if (mode !== "fixed" && mode !== "percent") {
    throw new PayrollError("Mode de calcul : montant fixe ou pourcentage attendu.");
  }
  const { amountXof, ratePercent } = resolveValues(mode, input.raw);

  return db.transaction(async (tx) => {
    await assertCodeAvailable(tx, input.tenantId, code);

    const [created] = await tx
      .insert(payrollComponents)
      .values({
        tenantId: input.tenantId,
        code,
        label,
        kind,
        mode,
        amountXof,
        ratePercent,
        taxable: checkboxOf(input.raw.taxable),
        createdByUserId: input.actorUserId,
      })
      .returning({ id: payrollComponents.id });
    if (!created) {
      throw new PayrollError("La rubrique de paie n'a pas pu être créée.");
    }

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "payroll.component.create",
      entityType: "payroll_components",
      entityId: created.id,
      details: { code, label, kind, mode, amountXof, ratePercent },
    });

    return { id: created.id };
  });
}

function resolveValues(
  mode: string,
  raw: { readonly amountXof: unknown; readonly ratePercent: unknown },
): { amountXof: number; ratePercent: string } {
  if (mode === "percent") {
    const ratePercent = parseRate(raw.ratePercent, "Taux de la rubrique");
    if (ratePercent === "0") {
      throw new PayrollError("Taux de la rubrique : doit être strictement positif.");
    }
    return { amountXof: 0, ratePercent };
  }
  const amountXof = parseAmountXof(raw.amountXof, "Montant de la rubrique");
  if (amountXof === 0) {
    throw new PayrollError("Montant de la rubrique : doit être strictement positif.");
  }
  return { amountXof, ratePercent: "0" };
}

export interface UpdatePayrollComponentInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly componentId: string;
  readonly raw: {
    readonly label: unknown;
    readonly amountXof: unknown;
    readonly ratePercent: unknown;
    readonly taxable: unknown;
  };
}

/** PAY-003 — le code d'une rubrique est immuable : libellé, montant, taux et imposition se corrigent. */
export async function updatePayrollComponent(
  db: Database,
  input: UpdatePayrollComponentInput,
): Promise<void> {
  const label = textOf(input.raw.label);
  validateLabel(label);

  await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: payrollComponents.id,
        code: payrollComponents.code,
        label: payrollComponents.label,
        mode: payrollComponents.mode,
      })
      .from(payrollComponents)
      .where(
        and(
          eq(payrollComponents.tenantId, input.tenantId),
          eq(payrollComponents.id, input.componentId),
        ),
      )
      .limit(1);
    if (!existing) {
      throw new PayrollError("Rubrique introuvable dans cet espace.");
    }

    const { amountXof, ratePercent } = resolveValues(existing.mode, input.raw);

    await tx
      .update(payrollComponents)
      .set({
        label,
        amountXof,
        ratePercent,
        taxable: checkboxOf(input.raw.taxable),
        updatedByUserId: input.actorUserId,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(payrollComponents.tenantId, input.tenantId),
          eq(payrollComponents.id, input.componentId),
        ),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: "payroll.component.update",
      entityType: "payroll_components",
      entityId: input.componentId,
      details: {
        code: existing.code,
        before: existing.label,
        after: label,
        amountXof,
        ratePercent,
      },
    });
  });
}

export interface SetPayrollComponentActiveInput {
  readonly tenantId: string;
  readonly actorUserId: string;
  readonly componentId: string;
  readonly active: boolean;
}

/** PAY-004 — une rubrique inactive n'entre plus dans aucun bulletin : l'historique reste intact. */
export async function setPayrollComponentActive(
  db: Database,
  input: SetPayrollComponentActiveInput,
): Promise<void> {
  await db.transaction(async (tx) => {
    const [component] = await tx
      .select({
        id: payrollComponents.id,
        code: payrollComponents.code,
        active: payrollComponents.active,
      })
      .from(payrollComponents)
      .where(
        and(
          eq(payrollComponents.tenantId, input.tenantId),
          eq(payrollComponents.id, input.componentId),
        ),
      )
      .limit(1);
    if (!component) {
      throw new PayrollError("Rubrique introuvable dans cet espace.");
    }
    if (component.active === input.active) {
      return;
    }

    await tx
      .update(payrollComponents)
      .set({ active: input.active, updatedByUserId: input.actorUserId, updatedAt: new Date() })
      .where(
        and(
          eq(payrollComponents.tenantId, input.tenantId),
          eq(payrollComponents.id, input.componentId),
        ),
      );

    await tx.insert(auditEvents).values({
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      action: input.active ? "payroll.component.activate" : "payroll.component.deactivate",
      entityType: "payroll_components",
      entityId: input.componentId,
      details: { code: component.code },
    });
  });
}
