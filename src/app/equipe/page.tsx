import type { Metadata } from "next";
import { Suspense } from "react";
import { connection } from "next/server";
import { Users } from "lucide-react";
import { AppHeader } from "@/components/app-header";
import { LoadingShell } from "@/components/loading-shell";
import {
  AddMemberForm,
  MemberLevelsForm,
  MemberRoleForm,
  ModuleResponsibleForm,
  RemoveMemberForm,
} from "@/components/team-forms";
import { LevelBadge } from "@/components/level-badge";
import { getDb } from "@/db/client";
import { requirePermission } from "@/lib/auth/session";
import {
  defaultLevel,
  effectiveLevel,
  levelLabel,
  moduleLabel,
  MODULE_KEYS,
  type ModuleKey,
} from "@/modules/identity/modules";
import { can } from "@/modules/identity/permissions";
import { listMembershipsForUser } from "@/modules/identity/queries";
import { listTeam } from "@/modules/identity/team";

export const metadata: Metadata = {
  title: "Équipe et droits",
};

const TH = "px-4 py-2.5 font-normal";

const NOTICES: Record<string, string> = {
  "membre=ajoute": "Membre ajouté à l’espace.",
  "membre=retire": "Membre retiré de l’espace ; ses concessions ont suivi.",
  "role=enregistre":
    "Rôle enregistré ; les concessions de module ont été remises au défaut du rôle.",
  "droits=enregistres": "Concessions de module enregistrées.",
  "droits=inchanges": "Aucune concession ne changeait : rien n’a été réécrit.",
  "responsable=enregistre": "Responsable de module désigné.",
};

function notice(query: Record<string, string | string[] | undefined>): string | null {
  for (const [key, message] of Object.entries(NOTICES)) {
    const [flag, value] = key.split("=") as [string, string];
    if (query[flag] === value) {
      return message;
    }
  }
  return null;
}

export default function TeamPage(props: PageProps<"/equipe">) {
  return (
    <Suspense fallback={<LoadingShell label="Chargement de l’équipe…" />}>
      <TeamContent searchParams={props.searchParams} />
    </Suspense>
  );
}

async function TeamContent({ searchParams }: Pick<PageProps<"/equipe">, "searchParams">) {
  await connection();
  const session = await requirePermission("members.read");
  const db = getDb();
  const [query, memberships, team] = await Promise.all([
    searchParams,
    listMembershipsForUser(db, session.userId),
    listTeam(db, session.tenantId),
  ]);

  const manage = can(session.role, "members.manage");
  const responsibleByModule = new Map<ModuleKey, string>(
    team.responsibles.map((row) => [row.module, row.userId]),
  );
  const roster = team.members.map((member) => ({ userId: member.userId, name: member.name }));
  const info = notice(query);

  return (
    <div className="min-h-dvh">
      <AppHeader session={session} memberships={memberships} active="team" />

      <main className="mx-auto max-w-6xl px-6 py-8 md:px-10 md:py-10">
        <div className="flex flex-wrap items-end justify-between gap-2 border-b border-line pb-4">
          <div>
            <p className="font-mono text-[10px] tracking-[0.18em] text-brand uppercase">
              Responsabilisation
            </p>
            <h1 className="mt-1 text-2xl font-medium tracking-tight">Équipe et droits</h1>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-panel px-2.5 py-1 text-[10px] text-muted">
            <Users className="size-3" aria-hidden="true" />
            {team.members.length} membre{team.members.length > 1 ? "s" : ""} · {MODULE_KEYS.length}{" "}
            modules
          </span>
        </div>

        <p className="mt-4 max-w-2xl text-[11px] leading-5 text-muted">
          Chaque module se lit, s&apos;écrit et se gère séparément. Sans concession, une personne
          hérite du défaut de son rôle ; le propriétaire gère tout, de droit. Gérer un module,
          c&apos;est faire sortir un document de son brouillon et enregistrer le paramétrage du
          module.
        </p>

        {info ? (
          <p className="mt-4 rounded-md border border-brand/20 bg-brand-soft px-3 py-2 text-[11px] text-brand-strong">
            {info}
          </p>
        ) : null}

        {manage ? (
          <section className="mt-6 rounded-xl border border-line bg-panel p-5">
            <h2 className="text-sm font-medium tracking-tight">Ajouter un membre</h2>
            <AddMemberForm />
          </section>
        ) : null}

        <section className="mt-6 space-y-4">
          <h2 className="text-sm font-medium tracking-tight">Qui fait partie de l&apos;espace</h2>
          {team.members.map((member) => (
            <article key={member.userId} className="rounded-xl border border-line bg-panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">
                    {member.name}
                    {member.userId === session.userId ? " (vous)" : ""}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-muted">{member.email}</p>
                  <p className="mt-1 text-[11px] text-muted">
                    {member.responsibleOf.length > 0
                      ? `Responsable de : ${member.responsibleOf
                          .map((key) => moduleLabel(key))
                          .join(", ")}`
                      : "Aucune responsabilité de module."}
                  </p>
                </div>
                <span className="rounded-full border border-line bg-canvas px-2.5 py-1 text-[10px] text-muted">
                  {member.joinedAt.toLocaleDateString("fr-FR")}
                </span>
              </div>

              {manage && member.userId !== session.userId ? (
                <div className="mt-4 flex flex-wrap items-end gap-3">
                  <MemberRoleForm userId={member.userId} role={member.role} />
                  <RemoveMemberForm userId={member.userId} name={member.name} />
                </div>
              ) : null}

              {manage && member.role !== "owner" && member.userId !== session.userId ? (
                <details className="mt-4 rounded-lg border border-line bg-canvas px-4 py-3">
                  <summary className="cursor-pointer text-[11px] font-medium">
                    Droits par module —{" "}
                    {MODULE_KEYS.map((key) => levelLabel(member.levels[key]))
                      .filter((label, index, all) => all.indexOf(label) === index)
                      .join(", ")}
                  </summary>
                  <div className="mt-4">
                    <MemberLevelsForm
                      userId={member.userId}
                      name={member.name}
                      role={member.role}
                      grants={member.grants}
                    />
                  </div>
                </details>
              ) : member.role === "owner" ? (
                <p className="mt-4 text-[10px] text-muted">
                  Le propriétaire gère les treize modules : aucune concession ne s&apos;applique.
                </p>
              ) : null}
            </article>
          ))}
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Matrice des droits</h2>
          <div className="overflow-x-auto rounded-xl border border-line bg-panel">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">
                Niveau de droit de chaque membre sur chaque module
              </caption>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className={TH}>
                    Membre
                  </th>
                  {MODULE_KEYS.map((key) => (
                    <th key={key} scope="col" className={`${TH} whitespace-nowrap`}>
                      {moduleLabel(key)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {team.members.map((member) => (
                  <tr key={member.userId} className="border-b border-line last:border-b-0">
                    <th scope="row" className={`${TH} font-medium whitespace-nowrap`}>
                      {member.name}
                    </th>
                    {MODULE_KEYS.map((key) => {
                      const level = effectiveLevel(member.role, key, member.grants[key] ?? null);
                      const conceded = member.grants[key] !== undefined;
                      return (
                        <td key={key} className={TH}>
                          <LevelBadge
                            level={level}
                            title={
                              conceded
                                ? `Concession explicite (défaut du rôle : ${levelLabel(defaultLevel(member.role, key))})`
                                : `Défaut du rôle ${member.role}`
                            }
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <section className="mt-8 space-y-3">
          <h2 className="text-sm font-medium tracking-tight">Responsables de module</h2>
          <p className="max-w-2xl text-[11px] leading-5 text-muted">
            Un responsable n&apos;acquiert aucun droit par sa désignation : c&apos;est la personne à
            qui l&apos;on rend des comptes sur ce module.
          </p>
          <div className="overflow-hidden rounded-xl border border-line bg-panel">
            <table className="w-full text-left text-[11px]">
              <caption className="sr-only">Responsable désigné pour chaque module</caption>
              <thead>
                <tr className="border-b border-line font-mono text-[10px] tracking-[0.12em] text-muted uppercase">
                  <th scope="col" className={TH}>
                    Module
                  </th>
                  <th scope="col" className={TH}>
                    Responsable actuel
                  </th>
                  {manage ? (
                    <th scope="col" className={TH}>
                      Désigner
                    </th>
                  ) : null}
                </tr>
              </thead>
              <tbody>
                {MODULE_KEYS.map((key) => {
                  const currentUserId = responsibleByModule.get(key) ?? null;
                  const current = team.members.find((member) => member.userId === currentUserId);
                  return (
                    <tr key={key} className="border-b border-line last:border-b-0">
                      <th scope="row" className={`${TH} font-medium whitespace-nowrap`}>
                        {moduleLabel(key)}
                      </th>
                      <td className={TH}>{current?.name ?? "—"}</td>
                      {manage ? (
                        <td className={TH}>
                          <ModuleResponsibleForm
                            moduleKey={key}
                            currentUserId={currentUserId}
                            members={roster}
                          />
                        </td>
                      ) : null}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
