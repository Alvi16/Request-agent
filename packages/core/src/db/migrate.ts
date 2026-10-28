import { fileURLToPath } from "node:url";

import { migrate } from "drizzle-orm/node-postgres/migrator";

import type { Database } from "./client.ts";

const migrationsFolder = fileURLToPath(new URL("../../drizzle", import.meta.url));

// Applies the migrations not applied yet, in order. Running it again changes nothing.
export async function migrateDatabase(db: Database): Promise<void> {
  await migrate(db, { migrationsFolder });
}
