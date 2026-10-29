import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportSection } from "@/components/import-section";
import { LoadingShell } from "@/components/loading-shell";

export const metadata: Metadata = {
  title: "Importer le plan comptable",
};

export default function AccountsImportPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de l'import…" />}>
      <ImportSection kind="accounts" active="accounting" />
    </Suspense>
  );
}
