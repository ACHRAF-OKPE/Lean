import type { Metadata } from "next";
import { Suspense } from "react";
import { ImportSection } from "@/components/import-section";
import { LoadingShell } from "@/components/loading-shell";

export const metadata: Metadata = {
  title: "Importer le personnel",
};

export default function HrEmployeesImportPage() {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture de l'import…" />}>
      <ImportSection kind="hr_employees" active="hr" />
    </Suspense>
  );
}
