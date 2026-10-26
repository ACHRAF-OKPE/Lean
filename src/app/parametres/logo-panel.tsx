"use client";

import { useActionState } from "react";
import Image from "next/image";
import { LoaderCircle, Trash2, Upload } from "lucide-react";
import { FormErrors, INPUT_CLASS } from "@/components/form-fields";
import { removeCompanyLogoAction, uploadCompanyLogoAction } from "@/lib/settings/actions";
import { EMPTY_SETTINGS_FORM_STATE } from "@/lib/settings/form-state";

export function LogoPanel({
  hasLogo,
  version,
  tenantName,
  editable,
}: {
  hasLogo: boolean;
  version: number;
  tenantName: string;
  editable: boolean;
}) {
  const [uploadState, uploadAction, uploading] = useActionState(
    uploadCompanyLogoAction,
    EMPTY_SETTINGS_FORM_STATE,
  );
  const [removeState, removeAction, removing] = useActionState(
    removeCompanyLogoAction,
    EMPTY_SETTINGS_FORM_STATE,
  );

  return (
    <section className="rounded-xl border border-line bg-panel p-5">
      <h2 className="text-sm font-semibold">Logo</h2>
      <p className="mt-1 text-[10px] leading-4 text-muted">
        PNG, JPEG ou WebP, 512 Kio maximum. Le type est vérifié sur la signature du fichier.
      </p>

      <div className="mt-4 flex min-h-24 items-center justify-center rounded-lg border border-dashed border-line bg-canvas p-4">
        {hasLogo ? (
          <Image
            src={`/api/entreprise/logo?v=${version}`}
            alt="Logo de l'entreprise"
            width={200}
            height={64}
            unoptimized
            className="h-16 w-auto max-w-full object-contain"
          />
        ) : (
          <span
            aria-hidden="true"
            className="grid size-14 place-items-center rounded-xl bg-brand text-xl font-semibold text-canvas"
          >
            {tenantName.trim().charAt(0).toUpperCase() || "L"}
          </span>
        )}
      </div>

      {editable ? (
        <div className="mt-4 space-y-3">
          <form action={uploadAction} className="space-y-2">
            <label htmlFor="logo" className="block text-[11px] font-medium">
              {hasLogo ? "Remplacer le logo" : "Ajouter un logo"}
            </label>
            <input
              id="logo"
              name="logo"
              type="file"
              required
              accept="image/png,image/jpeg,image/webp"
              className={`${INPUT_CLASS} text-[11px] file:mr-3 file:rounded file:border-0 file:bg-canvas file:px-2 file:py-1 file:text-[10px] file:text-muted`}
            />
            <div className="flex justify-end">
              <button
                type="submit"
                disabled={uploading}
                aria-label="Téléverser le logo"
                title="Téléverser le logo"
                className="grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand disabled:opacity-50"
              >
                {uploading ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Upload className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </form>
          <FormErrors errors={uploadState.errors} />

          {hasLogo ? (
            <form action={removeAction} className="border-t border-line pt-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-[10px] leading-4 text-muted">
                  Le retrait remet l&apos;initiale de l&apos;entreprise.
                </p>
                <button
                  type="submit"
                  disabled={removing}
                  onClick={(event) => {
                    if (!window.confirm("Retirer le logo de l'entreprise ?")) {
                      event.preventDefault();
                    }
                  }}
                  aria-label="Retirer le logo"
                  title="Retirer le logo"
                  className="grid size-8 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-copper/40 hover:text-copper disabled:opacity-50"
                >
                  {removing ? (
                    <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  )}
                </button>
              </div>
            </form>
          ) : null}
          <FormErrors errors={removeState.errors} />
        </div>
      ) : (
        <p className="mt-4 text-[10px] text-muted">
          Lecture seule : la modification exige la permission paramètres.
        </p>
      )}
    </section>
  );
}
