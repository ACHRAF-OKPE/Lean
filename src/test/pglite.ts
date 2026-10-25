import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { Database } from "@/db/client";
import * as schema from "@/db/schema";

export interface TestDatabase {
  readonly db: Database;
  close: () => Promise<void>;
}

export async function createTestDatabase(): Promise<TestDatabase> {
  const client = new PGlite();
  const db = drizzle(client, { schema, casing: "snake_case" });
  await migrate(db, { migrationsFolder: "./drizzle" });
  return { db: db as unknown as Database, close: () => client.close() };
}
