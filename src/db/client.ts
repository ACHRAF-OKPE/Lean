import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant.");
  }

  const client = postgres(url, { max: 1, prepare: false });
  return drizzle(client, { schema, casing: "snake_case" });
}

let instance: ReturnType<typeof createDb> | undefined;

export function getDb(): ReturnType<typeof createDb> {
  instance ??= createDb();
  return instance;
}

export type Database = ReturnType<typeof createDb>;
