import type { Metadata } from "next";
import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ArrowLeft, ArrowUpRight, Network, Plus } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { DepartmentActiveButton } from "@/components/hr-forms";
import { LoadingShell } from "@/components/loading-shell";
import { getDb } from "@/db/client";
import { canAccessModule, requireModule } from "@/lib/auth/session";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { getDepartmentTree, type DepartmentNode } from "@/modules/hr/queries";

export const metadata: Metadata = {
  title: "Organisation",
};

const TH = "px-4 py-2.5 font-normal";
const ACTION_LINK =
  "grid size-9 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand";

interface Row {
  readonly node: DepartmentNode;
  readonly depth: number;
}

function toRows(nodes: readonly DepartmentNode[], depth = 0, out: Row[] = []): Row[] {
  for (const node of nodes) {
    out.push({ node, depth });
    toRows(node.children, depth + 1, out);
  }
  return out;
}

export default function OrganisationPage(props: PageProps<"/rh/organisation">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de l'organisation…" />}>
      <OrganisationContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function OrganisationContent({
  searchParams,
}: Pick<PageProps<"/rh/organisation">, "searchParams">) {
  await connection();
  const session = await requireModule("hr", "read");
  const db = getDb();
  const [tree, memberships, query, canWrite] = await Promise.all([
    getDepartmentTree(db, { tenantId: session.tenantId }),
    listMembershipsForUser(db, session.userId),
    searchParams,
    canAccessModule(session, "hr", "write"),
  ]);
  const created = typeof query.cree === "string";
  const updated = typeof query.maj === "string";
  const rows = toRows(tree);
  const inactive = rows.filter((row) => !row.node.active).length;

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="hr" />

      <main className="mx-auto max-w-5xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <Link
              href="/rh"
              aria-label="Revenir aux ressources humaines"
              title="Revenir aux ressources humaines"
              className={ACTION_LINK}
            >
              <ArrowLeft className="size-4" aria-hidden="true" />
            </Link>
            <div>
              <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
                Ressources humaines
              </p>
              <h1 className="text-2xl font-medium tracking-tight">Organisation</h1>
            </div>
          </div>
          {canWrite ? (
            <Link
              href="/rh/organisation/nouveau"
              aria-label="Créer un service"
              title="Créer un service"
              className={ACTION_LINK}
            >
              <Plus className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
        <p className="mt-3 max-w-2xl text-[11px] leading-5 text-muted">
          Arborescence des services de l&apos;espace. Chaque nœud affiche son effectif propre et
          l&apos;effectif cumulé avec ses descendants. Un service qui a des enfants ou des salariés
          ne se supprime pas : il se désactive, et les fiches conservent la référence.
        </p>

        {created || updated ? (
          <p
            role="status"
            className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] leading-5 text-brand-strong"
          >
            {created ? "Service créé." : "Service mis à jour."}
          </p>
        ) : null}

        <dl className="mt-5 grid gap-2 sm:grid-cols-3">
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Services</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{rows.length}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Services inactifs</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{inactive}</dd>
          </div>
          <div className="rounded-lg border border-line bg-panel px-4 py-3">
            <dt className="text-[10px] text-muted">Services racines</dt>
            <dd className="mt-1 font-mono text-2xl tabular-nums">{tree.length}</dd>
          </div>
        </dl>

        <section className="mt-5 overflow-hidden rounded-xl border border-line bg-panel">
          {rows.length === 0 ? (
            <div className="px-5 py-12 text-center">
              <Network className="mx-auto size-6 text-brand" aria-hidden="true" />
              <p className="mt-3 text-[11px] leading-5 text-muted">
                Aucun service dans cet espace. Créez le premier nœud de l&apos;organigramme.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-[11px]">
                <caption className="sr-only">Arborescence des services de l&apos;espace</caption>
                <thead>
                  <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                    <th scope="col" className={TH}>
                      Service
                    </th>
                    <th scope="col" className={TH}>
                      Responsable
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Effectif
                    </th>
                    <th scope="col" className={`${TH} text-right`}>
                      Cumulé
                    </th>
                    <th scope="col" className={TH}>
                      Statut
                    </th>
                    {canWrite ? (
                      <th scope="col" className={`${TH} text-right`}>
                        Activer
                      </th>
                    ) : null}
                    <th scope="col" className={`${TH} text-right`}>
                      Ouvrir
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => (
                    <tr key={row.node.id} className="border-b border-line last:border-b-0">
                      <td className="px-4 py-2.5">
                        <span
                          className="flex items-center gap-2"
                          style={{ paddingLeft: `${row.depth * 14}px` }}
                        >
                          {row.depth > 0 ? (
                            <span className="font-mono text-[10px] text-muted">└</span>
                          ) : null}
                          <span className="font-mono text-[10px] whitespace-nowrap">
                            {row.node.code}
                          </span>
                          <span className="font-medium">{row.node.name}</span>
                        </span>
                        {row.node.parentName ? (
                          <span className="mt-0.5 block pl-4 text-[10px] text-muted">
                            rattaché à {row.node.parentName}
                          </span>
                        ) : null}
                      </td>
                      <td className="px-4 py-2.5">{row.node.responsibleName ?? "—"}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">{row.node.headcount}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums">
                        {row.node.totalHeadcount}
                      </td>
                      <td className="px-4 py-2.5">
                        {row.node.active ? (
                          <span className="font-mono text-[10px] text-brand-strong">Actif</span>
                        ) : (
                          <span className="font-mono text-[10px] text-muted">Inactif</span>
                        )}
                      </td>
                      {canWrite ? (
                        <td className="px-4 py-2.5">
                          <div className="flex justify-end">
                            <DepartmentActiveButton
                              departmentId={row.node.id}
                              code={row.node.code}
                              active={row.node.active}
                            />
                          </div>
                        </td>
                      ) : null}
                      <td className="px-4 py-2.5 text-right">
                        <Link
                          href={`/rh/organisation/${row.node.id}`}
                          aria-label={`Ouvrir le service ${row.node.code}`}
                          title="Ouvrir le service"
                          className="ml-auto grid size-7 place-items-center rounded-md border border-line bg-panel text-muted transition-colors hover:border-brand/30 hover:text-brand"
                        >
                          <ArrowUpRight className="size-3.5" aria-hidden="true" />
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
