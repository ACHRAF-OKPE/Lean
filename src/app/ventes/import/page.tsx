import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/loading-shell";
import { ImportSection } from "@/components/import-section";

export const metadata: Metadata = {
  title: "Importer des lignes de vente",
};

export default function SalesImportPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de l'import…" />}>
      <ImportSection kind="sales_lines" active="sales" />
    </Suspense>
  );
}
