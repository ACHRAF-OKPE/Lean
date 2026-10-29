"use client";

import { useActionState, useState } from "react";
import { LoaderCircle, Save } from "lucide-react";
import { Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import type { SupplierOption } from "@/modules/purchases/queries";
import type { SupplyPolicyRow } from "@/modules/supply/queries";
import { savePolicyAction } from "@/lib/supply/actions";
import { EMPTY_SUPPLY_FORM_STATE } from "@/lib/supply/form-state";

interface EditorValues {
  readonly supplierId: string;
  readonly leadTimeDays: string;
  readonly safetyDelayDays: string;
  readonly minStockQty: string;
  readonly reorderQty: string;
  readonly orderMultipleQty: string;
  readonly active: boolean;
}

function valuesOf(
  row: SupplyPolicyRow | undefined,
  suppliers: readonly SupplierOption[],
): EditorValues {
  return {
    supplierId: row?.supplierId ?? suppliers[0]?.id ?? "",
    leadTimeDays: String(row?.leadTimeDays ?? 5),
    safetyDelayDays: String(row?.safetyDelayDays ?? 1),
    minStockQty: row?.minStockQty ?? "0",
    reorderQty: row?.reorderQty ?? "0",
    orderMultipleQty: row?.orderMultipleQty ?? "",
    active: row?.supplierId ? row.active : true,
  };
}

export function PolicyEditor({
  rows,
  suppliers,
}: {
  rows: readonly SupplyPolicyRow[];
  suppliers: readonly SupplierOption[];
}) {
  const [articleId, setArticleId] = useState(rows[0]?.articleId ?? "");
  const [values, setValues] = useState<EditorValues>(() => valuesOf(rows[0], suppliers));
  const [state, formAction, pending] = useActionState(savePolicyAction, EMPTY_SUPPLY_FORM_STATE);

  const selected = rows.find((row) => row.articleId === articleId);

  function changeArticle(nextId: string) {
    setArticleId(nextId);
    setValues(
      valuesOf(
        rows.find((row) => row.articleId === nextId),
        suppliers,
      ),
    );
  }

  return (
    <form action={formAction} className="rounded-xl border border-line bg-panel px-4 py-4 md:px-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-medium">Politique d&apos;approvisionnement</h2>
          <p className="mt-0.5 text-[10px] leading-4 text-muted">
            Un fournisseur par défaut par article. Le calcul des besoins applique ces délais et
            seuils, puis arrondit la proposition au multiple de commande.
          </p>
        </div>
        <span className="rounded-full border border-line bg-canvas px-2.5 py-1 font-mono text-[10px] text-muted">
          {selected?.supplierId ? "Politique existante" : "Nouvelle politique"}
        </span>
      </div>

      <input type="hidden" name="articleId" value={articleId} />

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <Field label="Article" htmlFor="policy-article">
          <select
            id="policy-article"
            value={articleId}
            onChange={(event) => changeArticle(event.target.value)}
            className={INPUT_CLASS}
          >
            {rows.map((row) => (
              <option key={row.articleId} value={row.articleId}>
                {row.articleCode} — {row.articleName}
                {row.supplierId ? " · suivie" : ""}
              </option>
            ))}
          </select>
        </Field>

        <Field label="Fournisseur par défaut" htmlFor="policy-supplier">
          <select
            id="policy-supplier"
            name="supplierId"
            value={values.supplierId}
            onChange={(event) => setValues({ ...values, supplierId: event.target.value })}
            className={INPUT_CLASS}
          >
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.code} — {supplier.name}
              </option>
            ))}
          </select>
        </Field>

        <Field
          label="Unité de l'article"
          htmlFor="policy-unit"
          hint="Les quantités ci-dessous sont exprimées dans cette unité."
        >
          <input
            id="policy-unit"
            value={selected?.unitCode ?? ""}
            readOnly
            className={`${INPUT_CLASS} bg-canvas text-muted`}
          />
        </Field>

        <Field label="Délai d'approvisionnement (jours)" htmlFor="policy-lead">
          <input
            id="policy-lead"
            name="leadTimeDays"
            type="number"
            min={0}
            max={365}
            step={1}
            value={values.leadTimeDays}
            onChange={(event) => setValues({ ...values, leadTimeDays: event.target.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Délai de sécurité (jours)" htmlFor="policy-safety">
          <input
            id="policy-safety"
            name="safetyDelayDays"
            type="number"
            min={0}
            max={60}
            step={1}
            value={values.safetyDelayDays}
            onChange={(event) => setValues({ ...values, safetyDelayDays: event.target.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Multiple de commande" htmlFor="policy-multiple" hint="Facultatif.">
          <input
            id="policy-multiple"
            name="orderMultipleQty"
            inputMode="decimal"
            value={values.orderMultipleQty}
            onChange={(event) => setValues({ ...values, orderMultipleQty: event.target.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <Field label="Stock minimum" htmlFor="policy-min">
          <input
            id="policy-min"
            name="minStockQty"
            inputMode="decimal"
            value={values.minStockQty}
            onChange={(event) => setValues({ ...values, minStockQty: event.target.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <Field
          label="Quantité de réapprovisionnement"
          htmlFor="policy-reorder"
          hint="Plancher de la proposition ; le manque au seuil l'emporte s'il est supérieur."
        >
          <input
            id="policy-reorder"
            name="reorderQty"
            inputMode="decimal"
            value={values.reorderQty}
            onChange={(event) => setValues({ ...values, reorderQty: event.target.value })}
            className={INPUT_CLASS}
          />
        </Field>

        <label className="mt-6 flex items-start gap-2 rounded-md border border-line bg-panel px-3 py-2">
          <input
            type="checkbox"
            name="active"
            checked={values.active}
            onChange={(event) => setValues({ ...values, active: event.target.checked })}
            className="mt-0.5 size-3.5 accent-brand"
          />
          <span>
            <span className="block text-[11px] font-medium">Politique active</span>
            <span className="block text-[10px] leading-4 text-muted">
              Une politique inactive est ignorée par le calcul.
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={pending || rows.length === 0 || suppliers.length === 0}
          aria-label="Enregistrer la politique d'approvisionnement"
          title="Enregistrer la politique"
          className="grid size-9 place-items-center rounded-md border border-transparent bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? (
            <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <Save className="size-4" aria-hidden="true" />
          )}
        </button>
        <p className="text-[10px] leading-4 text-muted">
          Enregistrez cette politique avant de lancer un calcul des besoins.
        </p>
      </div>

      <div className="mt-3">
        <FormErrors errors={state.errors} />
      </div>
    </form>
  );
}
