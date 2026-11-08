"use client";

import { useActionState, useEffect } from "react";
import { Check, FileSignature, LoaderCircle, Mail, Upload } from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import {
  confirmPurchaseSignatureAction,
  resendPurchaseSignatureNoticeAction,
  startPurchaseSignatureChainAction,
  uploadPurchaseSignatureAction,
} from "@/lib/purchases/actions";
import { EMPTY_PURCHASE_FORM_STATE } from "@/lib/purchases/form-state";
import type { PurchaseSignatureStep } from "@/modules/purchases/signatures";

const ICON_BUTTON =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:opacity-50";

export function PurchaseSignatureWorkflow({
  orderId,
  orderNumber,
  activeUserId,
  steps,
  hasConfiguredSigners,
  canManage,
}: {
  orderId: string;
  orderNumber: string | null;
  activeUserId: string;
  steps: readonly PurchaseSignatureStep[];
  hasConfiguredSigners: boolean;
  canManage: boolean;
}) {
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadPurchaseSignatureAction,
    EMPTY_PURCHASE_FORM_STATE,
  );
  const [confirmState, confirmAction, confirming] = useActionState(
    confirmPurchaseSignatureAction,
    EMPTY_PURCHASE_FORM_STATE,
  );
  const [startState, startAction, starting] = useActionState(
    startPurchaseSignatureChainAction,
    EMPTY_PURCHASE_FORM_STATE,
  );
  const [noticeState, noticeAction, notifying] = useActionState(
    resendPurchaseSignatureNoticeAction,
    EMPTY_PURCHASE_FORM_STATE,
  );
  const current = steps.find((step) => step.status !== "confirmed");

  // Faire défiler vers l'étape du signataire quand l'ancre est présente dans l'URL,
  // ou vers l'étape active quand c'est le tour de l'utilisateur connecté.
  useEffect(() => {
    const hash = window.location.hash;
    if (hash && steps.length > 0) {
      const targetSequence = Number(hash.replace("#signature-", ""));
      if (!Number.isNaN(targetSequence)) {
        const el = document.getElementById(`signature-${targetSequence}`);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }
    } else if (current && current.signerUserId === activeUserId) {
      const el = document.getElementById(`signature-${current.sequence}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [steps.length, current, activeUserId]);

  return (
    <section className="mt-6 rounded-xl border border-line bg-panel p-5">
      <div className="flex items-center gap-2">
        <FileSignature className="size-4 text-brand" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Circuit de signature</h2>
      </div>
      <a
        href={`/api/achats/${orderId}/signature-pdf`}
        className="mt-3 inline-block text-[10px] text-brand-strong underline underline-offset-2"
      >
        Télécharger le PO à signer
      </a>

      {steps.length === 0 ? (
        <div className="mt-3 space-y-3 text-[11px] leading-5 text-muted">
          {hasConfiguredSigners ? (
            <>
              <p>Le circuit n&apos;a pas encore été lancé pour ce PO.</p>
              {canManage ? (
                <form action={startAction} className="flex items-center gap-2">
                  <input type="hidden" name="orderId" value={orderId} />
                  <button
                    type="submit"
                    disabled={starting}
                    aria-label="Lancer le circuit de signature"
                    title="Lancer le circuit de signature"
                    className={ICON_BUTTON}
                  >
                    {starting ? (
                      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    ) : (
                      <FileSignature className="size-4" aria-hidden="true" />
                    )}
                  </button>
                  <FormErrors errors={startState.errors} />
                </form>
              ) : null}
            </>
          ) : (
            <p>Aucun signataire n&apos;est configuré dans les paramètres des achats.</p>
          )}
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {steps.map((step) => {
            const active = step.signerUserId === activeUserId && step.id === current?.id;
            return (
              <li
                key={step.id}
                id={`signature-${step.sequence}`}
                className="rounded-lg border border-line bg-canvas px-3 py-3"
              >
                <div className="flex items-center gap-2 text-[11px]">
                  <span className="grid size-6 place-items-center rounded-full border border-line font-mono text-[10px]">
                    {step.sequence}
                  </span>
                  <span className="font-medium">{step.signerName}</span>
                  <span className="text-muted">{step.signerEmail}</span>
                  <span className="ml-auto text-muted">
                    {step.status === "confirmed"
                      ? "Confirmée"
                      : step.status === "awaiting_confirmation"
                        ? "Dépôt à confirmer"
                        : active
                          ? "À votre tour"
                          : "En attente"}
                  </span>
                </div>

                {step.fileName ? (
                  <a
                    href={`/api/achats/${orderId}/signatures/${step.id}`}
                    className="mt-2 inline-block text-[10px] text-brand-strong underline underline-offset-2"
                  >
                    Consulter le PO signé : {step.fileName}
                  </a>
                ) : null}

                {active && step.status === "awaiting_upload" ? (
                  <form
                    action={uploadAction}
                    encType="multipart/form-data"
                    className="mt-3 flex flex-wrap items-end gap-2"
                  >
                    <input type="hidden" name="orderId" value={orderId} />
                    <label className="min-w-0 flex-1 text-[10px] text-muted">
                      Déposer le PO signé (PDF, 1 Mio maximum)
                      <input
                        type="file"
                        name="signedPo"
                        accept="application/pdf,.pdf"
                        required
                        className={`${INPUT_CLASS} mt-1`}
                      />
                    </label>
                    <button
                      type="submit"
                      disabled={uploading}
                      aria-label="Déposer le PO signé"
                      title="Déposer le PO signé"
                      className={ICON_BUTTON}
                    >
                      {uploading ? (
                        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                      ) : (
                        <Upload className="size-4" aria-hidden="true" />
                      )}
                    </button>
                    <FormErrors errors={uploadState.errors} />
                  </form>
                ) : null}

                {!active && step.status === "awaiting_upload" ? (
                  <p className="mt-2 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper">
                    Ce n&apos;est pas votre tour de signer : le signataire attendu est{" "}
                    <span className="font-medium">{current?.signerName}</span>. Il doit déposer le
                    PO signé et confirmer avant que le circuit ne vous revienne.
                  </p>
                ) : null}

                {active && step.status === "awaiting_confirmation" ? (
                  <form action={confirmAction} className="mt-3 space-y-2">
                    <input type="hidden" name="orderId" value={orderId} />
                    <label className="flex items-start gap-2 rounded-md border border-copper/30 bg-copper-soft px-3 py-2 text-[10px] leading-4 text-copper">
                      <input type="checkbox" name="confirmSignedPo" required className="mt-0.5" />
                      <span>
                        Je confirme avoir vérifié le fichier déposé et qu&apos;il s&apos;agit bien
                        du PO signé. Ma confirmation transmettra le document au signataire suivant.
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="submit"
                        disabled={confirming}
                        aria-label="Confirmer le dépôt du PO signé"
                        title="Confirmer le dépôt du PO signé"
                        className={ICON_BUTTON}
                      >
                        {confirming ? (
                          <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                        ) : (
                          <Check className="size-4" aria-hidden="true" />
                        )}
                      </button>
                      <FormErrors errors={confirmState.errors} />
                    </div>
                  </form>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}

      {steps.length > 0 && current && canManage ? (
        <form action={noticeAction} className="mt-3 flex items-center gap-2">
          <input type="hidden" name="orderId" value={orderId} />
          <button
            type="submit"
            disabled={notifying}
            aria-label="Renvoyer le courriel au signataire courant"
            title="Renvoyer le courriel au signataire courant"
            className={ICON_BUTTON}
          >
            {notifying ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Mail className="size-4" aria-hidden="true" />
            )}
          </button>
          <FormErrors errors={noticeState.errors} />
        </form>
      ) : null}

      {steps.length > 0 && !current ? (
        <p className="mt-3 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong">
          Toutes les signatures sont déposées et confirmées. L&apos;envoi au fournisseur exige
          encore une confirmation distincte des conditions de lancement.
        </p>
      ) : null}
      <p className="mt-3 text-[10px] text-muted">
        PO : {orderNumber ?? "sans numéro"}. Un dépôt seul ne fait pas avancer le circuit.
      </p>
    </section>
  );
}
