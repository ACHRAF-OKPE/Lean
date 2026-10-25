import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Lock } from "lucide-react";

export const metadata: Metadata = {
  title: "Accès refusé",
};

export default function AccessDeniedPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-sm rounded-xl border border-line bg-panel p-6 text-center">
        <div className="mx-auto grid size-10 place-items-center rounded-full border border-line bg-canvas text-muted">
          <Lock className="size-4" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-lg font-medium tracking-tight">Accès refusé</h1>
        <p className="mt-2 text-[11px] leading-5 text-muted">
          Votre rôle dans cet espace de travail ne permet pas d&apos;ouvrir cette page.
        </p>
        <Link
          href="/"
          className="mt-5 inline-flex items-center gap-1.5 text-[11px] font-medium text-brand hover:text-brand-strong"
        >
          <ArrowLeft className="size-3.5" aria-hidden="true" />
          Retour au poste de pilotage
        </Link>
      </div>
    </main>
  );
}
