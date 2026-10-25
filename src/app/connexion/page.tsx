import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = {
  title: "Connexion",
};

export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center px-6 py-10">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-3">
          <div
            aria-hidden="true"
            className="grid size-10 place-items-center rounded-lg bg-brand text-sm font-semibold text-canvas"
          >
            L
          </div>
          <div>
            <p className="text-sm font-semibold tracking-tight">Lean</p>
            <p className="text-[11px] text-muted">ERP supply chain &amp; douane</p>
          </div>
        </div>

        <div className="mt-8 rounded-xl border border-line bg-panel p-6">
          <h1 className="text-xl font-medium tracking-tight">Connexion</h1>
          <p className="mt-1.5 text-[11px] leading-5 text-muted">
            Accès réservé aux comptes de l&apos;entreprise. Les sessions sont vérifiées côté serveur
            et rattachées à un espace de travail.
          </p>

          <LoginForm />
        </div>

        <p className="mt-4 text-center text-[10px] leading-5 text-muted">
          Aucune inscription publique. Le premier propriétaire est créé par script.
        </p>
      </div>
    </main>
  );
}
