import type { Database } from "@/db/client";
import {
  customsOffices,
  customsRegimes,
  customsTaxes,
  hsCodes,
  partners,
  tenants,
  users,
} from "@/db/schema";

let tenantCounter = 0;

export interface CustomsTenant {
  readonly tenantId: string;
  readonly userId: string;
  readonly officeId: string;
  readonly bondRegimeId: string;
  readonly plainRegimeId: string;
  readonly partnerId: string;
  readonly inactivePartnerId: string;
  readonly hsCode: string;
  readonly secondHsCode: string;
  readonly zeroHsCode: string;
  readonly missingTecHsCode: string;
}

export async function seedCustomsTenant(db: Database, label = "douane"): Promise<CustomsTenant> {
  tenantCounter += 1;

  const [tenant] = await db
    .insert(tenants)
    .values({ slug: `test-douane-${tenantCounter}-${label}`, name: `Espace ${label}` })
    .returning({ id: tenants.id });
  const [user] = await db
    .insert(users)
    .values({
      email: `douane-${tenantCounter}@test.local`,
      name: "Koffi Test",
      passwordHash: "hash-de-test",
    })
    .returning({ id: users.id });

  if (!tenant || !user) {
    throw new Error("Tenant de test non créé.");
  }

  const [office] = await db
    .insert(customsOffices)
    .values({ tenantId: tenant.id, code: "CIABJ", name: "Abidjan Port" })
    .returning({ id: customsOffices.id });

  const regimeRows = await db
    .insert(customsRegimes)
    .values([
      {
        tenantId: tenant.id,
        code: "IM4",
        label: "Mise à la consommation",
        kind: "import" as const,
        requiresBond: false,
      },
      {
        tenantId: tenant.id,
        code: "IM8",
        label: "Admission temporaire",
        kind: "suspensive" as const,
        requiresBond: true,
      },
    ])
    .returning({ id: customsRegimes.id, code: customsRegimes.code });
  const regimeByCode = new Map(regimeRows.map((row) => [row.code, row.id]));

  await db.insert(customsTaxes).values([
    {
      tenantId: tenant.id,
      code: "TVA",
      label: "Taxe sur la valeur ajoutée",
      base: "cif_plus_duty" as const,
      rateBp: 1800,
      position: 20,
    },
    {
      tenantId: tenant.id,
      code: "PCS",
      label: "Prélèvement communautaire de solidarité",
      base: "cif" as const,
      rateBp: 100,
      position: 10,
    },
  ]);

  const partnerRows = await db
    .insert(partners)
    .values([
      {
        tenantId: tenant.id,
        code: "IMPORT01",
        name: "Ivoire Import SA",
        type: "company" as const,
        isCustomer: true,
        countryCode: "CI",
      },
      {
        tenantId: tenant.id,
        code: "IMPORT02",
        name: "Tiers inactif",
        type: "company" as const,
        isCustomer: true,
        active: false,
      },
    ])
    .returning({ id: partners.id, code: partners.code });
  const partnerByCode = new Map(partnerRows.map((row) => [row.code, row.id]));

  const hsRows = await db
    .insert(hsCodes)
    .values([
      { tenantId: tenant.id, code: "090111", wording: "Café non torréfié", tecRate: 10 },
      { tenantId: tenant.id, code: "170199", wording: "Sucre blanc", tecRate: 20 },
      { tenantId: tenant.id, code: "010121", wording: "Chevaux reproducteurs", tecRate: 0 },
      { tenantId: tenant.id, code: "999999", wording: "Code sans TEC" },
    ])
    .returning({ code: hsCodes.code });

  const officeId = office?.id;
  const bondRegimeId = regimeByCode.get("IM8");
  const plainRegimeId = regimeByCode.get("IM4");
  const partnerId = partnerByCode.get("IMPORT01");
  const inactivePartnerId = partnerByCode.get("IMPORT02");
  if (
    !officeId ||
    !bondRegimeId ||
    !plainRegimeId ||
    !partnerId ||
    !inactivePartnerId ||
    hsRows.length < 4
  ) {
    throw new Error("Référentiel de test incomplet.");
  }

  return {
    tenantId: tenant.id,
    userId: user.id,
    officeId,
    bondRegimeId,
    plainRegimeId,
    partnerId,
    inactivePartnerId,
    hsCode: "090111",
    secondHsCode: "170199",
    zeroHsCode: "010121",
    missingTecHsCode: "999999",
  };
}
