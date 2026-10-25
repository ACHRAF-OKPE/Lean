import type { Metadata } from "next";
import { Suspense } from "react";
import { LoadingShell } from "@/components/loading-shell";
import { ImportSection } from "@/components/import-section";

export const metadata: Metadata = {
  title: "Importer des lignes de commande",
};

export default function PurchaseImportPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de l'import…" />}>
      <ImportSection kind="purchase_lines" active="purchases" />
    </Suspense>
  );
}
