import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportSection } from "@/components/import-section";
import { LoadingShell } from "@/components/loading-shell";

export const metadata: Metadata = {
  title: "Importer des écritures",
};

export default function JournalEntriesImportPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de l'import…" />}>
      <ImportSection kind="journal_entries" active="accounting" />
    </Suspense>
  );
}
