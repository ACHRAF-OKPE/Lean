"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Download, FileSpreadsheet, FolderOpen, LoaderCircle, Play } from "lucide-react";
import type { ImportKind } from "@/db/schema";
import {
  IMPORT_KIND_LABELS,
  IMPORT_TEMPLATE_PATHS,
  MAX_IMPORT_FILE_MB,
  MAX_IMPORT_ROWS,
} from "@/modules/catalog/constants";

const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

export function ImportUploader({ kind }: { kind: ImportKind }) {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!fileInputRef.current?.files?.[0]) {
      setError("Choisissez d'abord un fichier .xlsx.");
      return;
    }

    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/imports/analyser", {
        method: "POST",
        body: new FormData(event.currentTarget),
      });
      const payload = (await response.json().catch(() => null)) as {
        batchId?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.batchId) {
        setError(payload?.error ?? "L'analyse a échoué. Réessayez.");
        return;
      }
      router.push(`/imports/${payload.batchId}`);
    } catch {
      setError("Réseau indisponible : relancez l'analyse.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 rounded-xl border border-line bg-panel p-5">
      <input type="hidden" name="kind" value={kind} />
      <input
        ref={fileInputRef}
        id="fichier"
        type="file"
        name="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="sr-only"
        onChange={(event) => {
          setFileName(event.target.files?.[0]?.name ?? null);
          setError(null);
        }}
      />

      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 place-items-center rounded-lg bg-brand-soft text-brand-strong">
          <FileSpreadsheet className="size-5" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">
            {fileName ?? `Aucun fichier sélectionné — modèle ${IMPORT_KIND_LABELS[kind]}`}
          </p>
          <p className="mt-0.5 text-[10px] leading-4 text-muted">
            Feuille « Données » · .xlsx · {MAX_IMPORT_FILE_MB} Mo max ·{" "}
            {MAX_IMPORT_ROWS.toLocaleString("fr-FR")} lignes max
          </p>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            aria-label="Choisir un fichier XLSX"
            title="Choisir un fichier XLSX"
            className={ACTION_LINK}
            disabled={busy}
          >
            <FolderOpen className="size-4" aria-hidden="true" />
          </button>
          <a
            href={IMPORT_TEMPLATE_PATHS[kind]}
            aria-label="Télécharger le modèle XLSX"
            title="Télécharger le modèle XLSX"
            className={ACTION_LINK}
          >
            <Download className="size-4" aria-hidden="true" />
          </a>
          <button
            type="submit"
            disabled={busy || !fileName}
            aria-label="Analyser le fichier"
            title="Analyser le fichier"
            className="grid size-9 place-items-center rounded-md bg-brand text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy ? (
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
            ) : (
              <Play className="size-4" aria-hidden="true" />
            )}
          </button>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-copper/20 bg-copper-soft px-3 py-2 text-[11px] leading-5 text-copper"
        >
          {error}
        </p>
      ) : null}

      <p className="mt-4 border-t border-line pt-3 text-[10px] leading-5 text-muted">
        L&apos;analyse vérifie chaque ligne et enregistre un rapport. Aucune donnée métier
        n&apos;est écrite avant votre confirmation. Le modèle contient le mode d&apos;emploi, les
        listes autorisées et un exemple.
      </p>
    </form>
  );
}
