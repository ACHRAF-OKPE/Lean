import "dotenv/config";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant.");
  }

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    await migrate(drizzle(sql), { migrationsFolder: "./drizzle" });
    console.log("Migrations à jour.");
  } finally {
    await sql.end();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
