"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import type { DeclarationTransition } from "@/modules/customs/lifecycle";
import { CustomsError } from "@/modules/customs/errors";
import {
  addDeclarationLine,
  apureBond,
  changeDeclarationStatus,
  createBond,
  createCustomsOffice,
  createCustomsRegime,
  createCustomsTax,
  createDeclaration,
  recordCustomsPayment,
  removeDeclarationLine,
  setCustomsOfficeActive,
  setCustomsRegimeActive,
  setCustomsTaxActive,
  updateDeclarationHeader,
} from "@/modules/customs/queries";
import type { CustomsFormState } from "./form-state";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TRANSITIONS = ["deposit", "liquidate", "clear", "cancel"] as const;

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

function isTransition(value: string): value is DeclarationTransition {
  return (TRANSITIONS as readonly string[]).includes(value);
}

function failure(error: unknown): CustomsFormState {
  if (error instanceof CustomsError) {
    return { errors: [error.message] };
  }
  throw error;
}

function headerRaw(formData: FormData) {
  return {
    regimeId: text(formData, "regimeId"),
    officeId: text(formData, "officeId"),
    partnerId: text(formData, "partnerId"),
    declarationDate: text(formData, "declarationDate"),
    externalReference: text(formData, "externalReference"),
    freightAmountXof: text(formData, "freightAmountXof"),
    insuranceAmountXof: text(formData, "insuranceAmountXof"),
  };
}

export async function createDeclarationAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");

  let declarationId: string;
  try {
    const created = await createDeclaration(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: headerRaw(formData),
    });
    declarationId = created.id;
  } catch (error) {
    return failure(error);
  }

  redirect(`/douane/${declarationId}?cree=1`);
}

export async function updateDeclarationAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const declarationId = text(formData, "declarationId");

  if (!UUID_PATTERN.test(declarationId)) {
    return { errors: ["Déclaration invalide."] };
  }

  try {
    await updateDeclarationHeader(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      declarationId,
      raw: headerRaw(formData),
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/douane/${declarationId}?maj=1`);
}

export async function addDeclarationLineAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const declarationId = text(formData, "declarationId");

  if (!UUID_PATTERN.test(declarationId)) {
    return { errors: ["Déclaration invalide."] };
  }

  try {
    await addDeclarationLine(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      declarationId,
      raw: {
        hsCode: text(formData, "hsCode"),
        designation: text(formData, "designation"),
        quantity: text(formData, "quantity"),
        unitCode: text(formData, "unitCode"),
        valueXof: text(formData, "valueXof"),
        weightKg: text(formData, "weightKg"),
        originCountry: text(formData, "originCountry"),
      },
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/douane/${declarationId}?maj=1`);
}

export async function removeDeclarationLineAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const declarationId = text(formData, "declarationId");
  const lineId = text(formData, "lineId");

  if (!UUID_PATTERN.test(declarationId) || !UUID_PATTERN.test(lineId)) {
    return { errors: ["Ligne invalide."] };
  }

  try {
    await removeDeclarationLine(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      declarationId,
      lineId,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/douane/${declarationId}?maj=1`);
}

export async function transitionDeclarationAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const declarationId = text(formData, "declarationId");
  const transition = text(formData, "transition");

  if (!UUID_PATTERN.test(declarationId)) {
    return { errors: ["Déclaration invalide."] };
  }
  if (!isTransition(transition)) {
    return { errors: ["Transition inconnue."] };
  }

  try {
    await changeDeclarationStatus(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      declarationId,
      transition,
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/douane/${declarationId}?maj=1`);
}

export async function createBondAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const declarationId = text(formData, "declarationId");

  if (!UUID_PATTERN.test(declarationId)) {
    return { errors: ["Déclaration invalide."] };
  }

  try {
    await createBond(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      declarationId,
      raw: {
        guaranteeAmountXof: text(formData, "guaranteeAmountXof"),
        guaranteeReference: text(formData, "guaranteeReference"),
      },
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/douane/${declarationId}?maj=1`);
}

export async function apureBondAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const bondId = text(formData, "bondId");
  const declarationId = text(formData, "declarationId");

  if (!UUID_PATTERN.test(bondId)) {
    return { errors: ["Acquit invalide."] };
  }

  try {
    await apureBond(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      bondId,
      raw: { reference: text(formData, "reference") },
    });
  } catch (error) {
    return failure(error);
  }

  redirect(
    UUID_PATTERN.test(declarationId) ? `/douane/${declarationId}?maj=1` : "/douane/acquits?maj=1",
  );
}

export async function recordCustomsPaymentAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const declarationId = text(formData, "declarationId");

  if (!UUID_PATTERN.test(declarationId)) {
    return { errors: ["Déclaration invalide."] };
  }

  try {
    await recordCustomsPayment(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      declarationId,
      raw: {
        amountXof: text(formData, "amountXof"),
        method: text(formData, "method"),
        paidDate: text(formData, "paidDate"),
        reference: text(formData, "reference"),
      },
    });
  } catch (error) {
    return failure(error);
  }

  redirect(`/douane/${declarationId}?maj=1`);
}

export async function createOfficeAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");

  try {
    await createCustomsOffice(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: { code: text(formData, "code"), name: text(formData, "name") },
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/douane/referentiels?maj=1");
}

export async function toggleOfficeAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const officeId = text(formData, "officeId");

  if (!UUID_PATTERN.test(officeId)) {
    return { errors: ["Bureau invalide."] };
  }

  try {
    await setCustomsOfficeActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      officeId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/douane/referentiels?maj=1");
}

export async function createRegimeAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");

  try {
    await createCustomsRegime(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        code: text(formData, "code"),
        label: text(formData, "label"),
        kind: text(formData, "kind"),
        requiresBond: text(formData, "requiresBond") === "on",
      },
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/douane/referentiels?maj=1");
}

export async function toggleRegimeAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const regimeId = text(formData, "regimeId");

  if (!UUID_PATTERN.test(regimeId)) {
    return { errors: ["Régime invalide."] };
  }

  try {
    await setCustomsRegimeActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      regimeId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/douane/referentiels?maj=1");
}

export async function createTaxAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");

  try {
    await createCustomsTax(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      raw: {
        code: text(formData, "code"),
        label: text(formData, "label"),
        base: text(formData, "base"),
        rateBp: text(formData, "rateBp"),
        position: text(formData, "position"),
      },
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/douane/referentiels?maj=1");
}

export async function toggleTaxAction(
  _state: CustomsFormState,
  formData: FormData,
): Promise<CustomsFormState> {
  const session = await requirePermission("data.write");
  const taxId = text(formData, "taxId");

  if (!UUID_PATTERN.test(taxId)) {
    return { errors: ["Taxe invalide."] };
  }

  try {
    await setCustomsTaxActive(getDb(), {
      tenantId: session.tenantId,
      actorUserId: session.userId,
      taxId,
      active: text(formData, "active") === "true",
    });
  } catch (error) {
    return failure(error);
  }

  redirect("/douane/referentiels?maj=1");
}
