import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Lean — ERP Supply Chain & Douane",
    template: "%s · Lean",
  },
  description:
    "ERP supply chain et douane : multi-tenant, SYSCOHADA, tarif extérieur UEMOA, régimes ASYCUDA.",
  applicationName: "Lean",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="fr">
      <body className="min-h-dvh bg-canvas text-ink antialiased">{children}</body>
    </html>
  );
}
