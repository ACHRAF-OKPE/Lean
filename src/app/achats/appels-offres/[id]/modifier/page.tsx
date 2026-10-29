import type { Metadata } from "next";
import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getArticleOptions } from "@/modules/purchases/queries";
import { getTender, getTenderSupplierOptions } from "@/modules/tenders/queries";
import { TenderForm } from "../../tender-form";

export const metadata: Metadata = {
  title: "Modifier la demande de cotation",
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default function EditTenderPage(props: PageProps<"/achats/appels-offres/[id]/modifier">) {
  return (
    <Suspense fallback={<LoadingShell label="Ouverture du brouillon…" />}>
      <EditTenderContent params={props.params} />
    </Suspense>
  );
}

async function EditTenderContent({
  params,
}: Pick<PageProps<"/achats/appels-offres/[id]/modifier">, "params">) {
  await connection();
  const session = await requirePermission("data.write");
  const { id } = await params;
  if (!UUID_PATTERN.test(id)) {
    notFound();
  }
  const db = getDb();
  const [detail, suppliers, articles, memberships] = await Promise.all([
    getTender(db, { tenantId: session.tenantId, tenderId: id }),
    getTenderSupplierOptions(db, session.tenantId),
    getArticleOptions(db, session.tenantId),
    listMembershipsForUser(db, session.userId),
  ]);
  if (!detail) {
    notFound();
  }
  if (detail.tender.status !== "draft") {
    redirect(`/achats/appels-offres/${id}`);
  }

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="tenders" />
      <main className="mx-auto max-w-4xl px-6 py-8 md:px-10 md:py-10">
        <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
          Achats · Appels d&apos;offres
        </p>
        <h1 className="mt-2 text-2xl font-medium tracking-tight">
          Modifier le brouillon de cotation
        </h1>
        <p className="mt-1 max-w-2xl text-[11px] leading-5 text-muted">
          Les lignes et les fournisseurs sont libres tant que la demande n&apos;est pas envoyée.
        </p>
        <TenderForm
          mode="edit"
          tenderId={detail.tender.id}
          suppliers={suppliers}
          articles={articles}
          initial={{
            title: detail.tender.title,
            deadline: detail.tender.deadline,
            notes: detail.tender.notes ?? "",
            lines: detail.lines.map((line) => ({
              articleId: line.articleId,
              qty: line.qty,
              requestedDate: line.requestedDate,
              note: line.note,
            })),
            supplierIds: detail.invitations.map((invitation) => invitation.supplierId),
          }}
        />
      </main>
    </div>
  );
}
