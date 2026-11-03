"use client";

import { useActionState, useRef, useState } from "react";
import {
  ArrowLeftRight,
  LoaderCircle,
  Plus,
  Power,
  Save,
  SlidersHorizontal,
  Trash2,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { CheckboxField, Field, FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { EMPTY_STOCK_FORM_STATE } from "@/lib/stock/form-state";
import {
  cancelStockMoveAction,
  createAdjustmentAction,
  createStockLocationAction,
  createTransferAction,
  saveStockSettingsAction,
  setStockLocationActiveAction,
  updateStockLocationAction,
} from "@/lib/stock/actions";

const SUBMIT =
  "grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-50";
const SECONDARY =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

const MAX_LINES = 50;

function SubmitIcon({ pending, icon: Icon }: { pending: boolean; icon: LucideIcon }) {
  return pending ? (
    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
  ) : (
    <Icon className="size-4" aria-hidden="true" />
  );
}

export interface StockArticleChoice {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly unitCode: string;
}

interface LineDraft {
  readonly key: number;
  readonly articleId: string;
  readonly qty: string;
}

const EMPTY_LINE: Omit<LineDraft, "key"> = { articleId: "", qty: "" };

/** STK-007/STK-008 — la saisie des lignes est partagée par le transfert et l'ajustement. */
function LineEditor({
  articles,
  pending,
  label,
}: {
  articles: readonly StockArticleChoice[];
  pending: boolean;
  label: string;
}) {
  const nextKey = useRef(2);
  const [lines, setLines] = useState<LineDraft[]>([{ key: 1, ...EMPTY_LINE }]);

  function updateLine(key: number, patch: Partial<Omit<LineDraft, "key">>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    setLines((current) => {
      if (current.length >= MAX_LINES) {
        return current;
      }
      const key = nextKey.current;
      nextKey.current += 1;
      return [...current, { key, ...EMPTY_LINE }];
    });
  }

  function removeLine(key: number) {
    setLines((current) => (current.length <= 1 ? current : current.filter((l) => l.key !== key)));
  }

  return (
    <div className="space-y-3 border-t border-line pt-4">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium">{label}</h3>
        <button
          type="button"
          onClick={addLine}
          disabled={pending || lines.length >= MAX_LINES}
          aria-label="Ajouter une ligne"
          title="Ajouter une ligne"
          className={SECONDARY}
        >
          <Plus className="size-4" aria-hidden="true" />
        </button>
      </div>

      {lines.map((line, index) => (
        <div
          key={line.key}
          className="grid gap-2 rounded-lg border border-line bg-canvas/40 p-3 md:grid-cols-[minmax(0,2fr)_minmax(0,0.8fr)_auto] md:items-end"
        >
          <Field label={`Article ${index + 1}`} htmlFor={`stock-article-${line.key}`}>
            <select
              id={`stock-article-${line.key}`}
              name="articleId"
              required
              value={line.articleId}
              onChange={(event) => updateLine(line.key, { articleId: event.target.value })}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un produit
              </option>
              {articles.map((article) => (
                <option key={article.id} value={article.id}>
                  {article.code} · {article.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Quantité" htmlFor={`stock-qty-${line.key}`}>
            <input
              id={`stock-qty-${line.key}`}
              name="qty"
              required
              inputMode="decimal"
              value={line.qty}
              onChange={(event) => updateLine(line.key, { qty: event.target.value })}
              placeholder="0"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
          <button
            type="button"
            onClick={() => removeLine(line.key)}
            disabled={lines.length <= 1}
            aria-label={`Supprimer la ligne ${index + 1}`}
            title="Supprimer la ligne"
            className={`${SECONDARY} disabled:opacity-40`}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        </div>
      ))}

      {articles.length === 0 ? (
        <p className="text-[10px] leading-4 text-muted">
          Aucun produit actif : seuls les articles de type produit génèrent un mouvement. Créez-en
          un depuis le registre des articles.
        </p>
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ magasins */

export function StockLocationForm() {
  const [state, formAction, pending] = useActionState(
    createStockLocationAction,
    EMPTY_STOCK_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-3">
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-[minmax(0,0.6fr)_minmax(0,1.8fr)_auto] md:items-end"
      >
        <legend className="sr-only">Nouveau magasin</legend>
        <Field label="Code" htmlFor="location-code" hint="2 à 12 caractères, ex. MAG2.">
          <input
            id="location-code"
            name="code"
            required
            maxLength={12}
            placeholder="MAG2"
            className={`${INPUT_CLASS} font-mono uppercase`}
          />
        </Field>
        <Field label="Nom" htmlFor="location-name" hint="80 caractères maximum.">
          <input
            id="location-name"
            name="name"
            required
            maxLength={80}
            placeholder="Magasin Abidjan"
            className={INPUT_CLASS}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label="Créer le magasin"
          title="Créer le magasin"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Plus} />
        </button>
      </fieldset>
    </form>
  );
}

export function StockLocationRenameForm({
  locationId,
  name,
}: {
  locationId: string;
  name: string;
}) {
  const [state, formAction, pending] = useActionState(
    updateStockLocationAction,
    EMPTY_STOCK_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-3 space-y-3">
      <input type="hidden" name="locationId" value={locationId} />
      <FormErrors errors={state.errors} />
      <fieldset
        disabled={pending}
        className="grid gap-3 md:grid-cols-[minmax(0,1.8fr)_auto] md:items-end"
      >
        <legend className="sr-only">Renommer le magasin</legend>
        <Field
          label="Nom du magasin"
          htmlFor="location-rename"
          hint="Le code reste immuable : seul le libellé se corrige."
        >
          <input
            id="location-rename"
            name="name"
            required
            maxLength={80}
            defaultValue={name}
            className={INPUT_CLASS}
          />
        </Field>
        <button
          type="submit"
          disabled={pending}
          aria-label="Enregistrer le nom du magasin"
          title="Enregistrer"
          className={SUBMIT}
        >
          <SubmitIcon pending={pending} icon={Save} />
        </button>
      </fieldset>
    </form>
  );
}

export function StockLocationToggleButton({
  locationId,
  code,
  active,
}: {
  locationId: string;
  code: string;
  active: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    setStockLocationActiveAction,
    EMPTY_STOCK_FORM_STATE,
  );

  return (
    <form action={formAction}>
      <input type="hidden" name="locationId" value={locationId} />
      <input type="hidden" name="active" value={active ? "false" : "true"} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={active ? `Désactiver le magasin ${code}` : `Activer le magasin ${code}`}
        title={active ? "Désactiver" : "Activer"}
        className={`grid size-7 place-items-center rounded-md border transition-colors disabled:opacity-50 ${
          active
            ? "border-line bg-panel text-muted hover:border-copper/30 hover:text-copper"
            : "border-brand/20 bg-brand-soft text-brand-strong hover:border-brand/40"
        }`}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Power className="size-3.5" aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

/* -------------------------------------------------------- transferts et ajustements */

export interface StockLocationChoice {
  readonly id: string;
  readonly code: string;
  readonly name: string;
}

export function TransferForm({
  locations,
  articles,
  today,
}: {
  locations: readonly StockLocationChoice[];
  articles: readonly StockArticleChoice[];
  today: string;
}) {
  const [state, formAction, pending] = useActionState(createTransferAction, EMPTY_STOCK_FORM_STATE);
  const [from, setFrom] = useState(locations[0]?.id ?? "");
  const [to, setTo] = useState(locations[1]?.id ?? locations[0]?.id ?? "");
  const sameLocation = from !== "" && from === to;

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Nouveau transfert</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Magasin d'origine" htmlFor="transfer-from" hint="D'où part le stock.">
            <select
              id="transfer-from"
              name="fromLocationId"
              required
              value={from}
              onChange={(event) => setFrom(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un magasin
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Magasin de destination" htmlFor="transfer-to" hint="Où arrive le stock.">
            <select
              id="transfer-to"
              name="toLocationId"
              required
              value={to}
              onChange={(event) => setTo(event.target.value)}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un magasin
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Date du transfert" htmlFor="transfer-date" hint="Aujourd'hui ou avant.">
            <input
              id="transfer-date"
              name="realDate"
              type="date"
              required
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
          <Field label="Notes" htmlFor="transfer-notes" hint="1000 caractères maximum.">
            <input
              id="transfer-notes"
              name="notes"
              maxLength={1000}
              placeholder="Réapprovisionnement du point de vente"
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        {sameLocation ? (
          <p
            role="alert"
            className="rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] text-copper"
          >
            Le magasin d&apos;origine et de destination doivent différer.
          </p>
        ) : null}

        <LineEditor articles={articles} pending={pending} label="Articles transférés" />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending || sameLocation || locations.length < 2}
            aria-label="Créer le transfert"
            title="Créer le transfert"
            className={`${SUBMIT} disabled:opacity-40`}
          >
            <SubmitIcon pending={pending} icon={ArrowLeftRight} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function AdjustmentForm({
  locations,
  articles,
  today,
  reasonRequired,
}: {
  locations: readonly StockLocationChoice[];
  articles: readonly StockArticleChoice[];
  today: string;
  reasonRequired: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    createAdjustmentAction,
    EMPTY_STOCK_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Nouvel ajustement d&apos;inventaire</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Magasin" htmlFor="adjustment-location" hint="Emplacement interne actif.">
            <select
              id="adjustment-location"
              name="locationId"
              required
              defaultValue={locations[0]?.id ?? ""}
              className={INPUT_CLASS}
            >
              <option value="" disabled>
                Sélectionner un magasin
              </option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Sens"
            htmlFor="adjustment-direction"
            hint="Une entrée corrige à la hausse, une sortie à la baisse."
          >
            <select
              id="adjustment-direction"
              name="direction"
              required
              defaultValue="in"
              className={INPUT_CLASS}
            >
              <option value="in">Entrée (constat d&apos;excédent)</option>
              <option value="out">Sortie (constat de manquant)</option>
            </select>
          </Field>
          <Field
            label="Motif"
            htmlFor="adjustment-reason"
            hint={reasonRequired ? "Obligatoire : 200 caractères maximum." : "Facultatif."}
          >
            <input
              id="adjustment-reason"
              name="reason"
              required={reasonRequired}
              maxLength={200}
              placeholder="Casse constatée à l'inventaire"
              className={INPUT_CLASS}
            />
          </Field>
          <Field
            label="Date de l'ajustement"
            htmlFor="adjustment-date"
            hint="Aujourd'hui ou avant."
          >
            <input
              id="adjustment-date"
              name="realDate"
              type="date"
              required
              defaultValue={today}
              className={INPUT_CLASS}
            />
          </Field>
        </div>

        <LineEditor articles={articles} pending={pending} label="Articles ajustés" />

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label="Créer l'ajustement d'inventaire"
            title="Créer l'ajustement"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={SlidersHorizontal} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export function CancelStockMoveButton({
  moveId,
  number,
  compact = false,
}: {
  moveId: string;
  number: string;
  compact?: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    cancelStockMoveAction,
    EMPTY_STOCK_FORM_STATE,
  );

  return (
    <form action={formAction} className={compact ? undefined : "space-y-2"}>
      <input type="hidden" name="moveId" value={moveId} />
      {state.errors.length > 0 ? <FormErrors errors={state.errors} /> : null}
      <button
        type="submit"
        disabled={pending}
        aria-label={`Annuler le mouvement ${number}`}
        title="Annuler le mouvement"
        className={compact ? `${SECONDARY} size-7` : SECONDARY}
      >
        {pending ? (
          <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
        ) : (
          <Undo2 className={compact ? "size-3.5" : "size-4"} aria-hidden="true" />
        )}
      </button>
    </form>
  );
}

/* ------------------------------------------------------------------ paramétrage */

export function StockSettingsForm({
  locations,
  values,
}: {
  locations: readonly StockLocationChoice[];
  values: {
    readonly defaultInternalLocationId: string | null;
    readonly defaultMinStockQty: string;
    readonly adjustmentReasonRequired: boolean;
  } | null;
}) {
  const [state, formAction, pending] = useActionState(
    saveStockSettingsAction,
    EMPTY_STOCK_FORM_STATE,
  );

  return (
    <form action={formAction} className="mt-4 space-y-4">
      <FormErrors errors={state.errors} />
      <fieldset disabled={pending} className="space-y-4">
        <legend className="sr-only">Paramétrage du stock</legend>
        <div className="grid gap-4 md:grid-cols-2">
          <Field
            label="Magasin par défaut"
            htmlFor="settings-default-location"
            hint="Destination proposée par défaut lors d'une réception."
          >
            <select
              id="settings-default-location"
              name="defaultInternalLocationId"
              defaultValue={values?.defaultInternalLocationId ?? ""}
              className={INPUT_CLASS}
            >
              <option value="">Aucun magasin par défaut</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.code} · {location.name}
                </option>
              ))}
            </select>
          </Field>
          <Field
            label="Seuil de réapprovisionnement par défaut"
            htmlFor="settings-min-stock"
            hint="Quantité de référence, zéro accepté."
          >
            <input
              id="settings-min-stock"
              name="defaultMinStockQty"
              inputMode="decimal"
              defaultValue={values?.defaultMinStockQty ?? "0"}
              placeholder="0"
              className={`${INPUT_CLASS} tabular-nums`}
            />
          </Field>
        </div>
        <CheckboxField
          name="adjustmentReasonRequired"
          label="Motif d'ajustement obligatoire"
          hint="Un ajustement d'inventaire exige alors un motif."
          defaultChecked={values?.adjustmentReasonRequired ?? true}
        />
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={pending}
            aria-label="Enregistrer le paramétrage du stock"
            title="Enregistrer"
            className={SUBMIT}
          >
            <SubmitIcon pending={pending} icon={Save} />
          </button>
        </div>
      </fieldset>
    </form>
  );
}
