import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { bootstrapOwner } from "../modules/identity/bootstrap";
import * as schema from "./schema";

config({ path: [".env.local", ".env"] });

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} manquant.`);
  }
  return value;
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant.");
  }

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    const result = await bootstrapOwner(drizzle(sql, { schema, casing: "snake_case" }), {
      tenantName: required("BOOTSTRAP_TENANT_NAME"),
      tenantSlug: required("BOOTSTRAP_TENANT_SLUG"),
      ownerName: required("BOOTSTRAP_OWNER_NAME"),
      email: required("BOOTSTRAP_EMAIL"),
      password: required("BOOTSTRAP_PASSWORD"),
    });

    console.log(
      result.membershipCreated
        ? "Propriétaire créé : connexion possible."
        : "Propriétaire déjà en place : aucune écriture.",
    );
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
