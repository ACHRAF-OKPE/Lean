import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportSection } from "@/components/import-section";
import { LoadingShell } from "@/components/loading-shell";

export const metadata: Metadata = {
  title: "Importer la nomenclature",
};

export default function ImportHsCodesPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de l'import…" />}>
      <ImportSection kind="hs_codes" active="nomenclature" />
    </Suspense>
  );
}
