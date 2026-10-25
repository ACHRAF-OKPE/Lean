import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

function createDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL manquant.");
  }
  return drizzle(neon(url), { schema, casing: "snake_case" });
}

let instance: ReturnType<typeof createDb> | undefined;

export function getDb() {
  instance ??= createDb();
  return instance;
}

export type Database = ReturnType<typeof createDb>;
