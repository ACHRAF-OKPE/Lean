import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportSection } from "@/components/import-section";
import { LoadingShell } from "@/components/loading-shell";

export const metadata: Metadata = {
  title: "Importer des articles",
};

export default function ImportArticlesPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de l'import…" />}>
      <ImportSection kind="articles" active="articles" />
    </Suspense>
  );
}
