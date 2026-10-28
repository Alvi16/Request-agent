import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { Client } from "pg";
import type { TestProject } from "vitest/node";

import { configureAppRole } from "../src/db/app-role.ts";
import { connectDatabase } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { loadAppDatabaseEnv, loadTestDatabaseEnv } from "../src/env.ts";

declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
    testAppDatabaseUrl: string;
  }
}

// The tests empty every table, so they only run on a database whose name marks it as disposable.
const testDatabaseName = /^[a-z0-9_]+_test$/;

const rootEnvFile = fileURLToPath(new URL("../../../.env", import.meta.url));

// Same test database, reached with the restricted role used by the application.
function asAppRole(testDatabaseUrl: URL, appDatabaseUrl: string): string {
  const appUrl = new URL(appDatabaseUrl);
  const url = new URL(testDatabaseUrl);
  url.username = appUrl.username;
  url.password = appUrl.password;
  return url.href;
}

async function createDatabaseIfMissing(databaseUrl: URL, name: string): Promise<void> {
  const maintenanceUrl = new URL(databaseUrl);
  maintenanceUrl.pathname = "/postgres";
  const client = new Client({ connectionString: maintenanceUrl.href });
  await client.connect();
  try {
    const existing = await client.query("select 1 from pg_database where datname = $1", [name]);
    if (existing.rowCount === 0) {
      // The name cannot be a query parameter; it is safe because it matched testDatabaseName.
      await client.query(`create database "${name}"`);
    }
  } finally {
    await client.end();
  }
}

export default async function setup(project: TestProject): Promise<void> {
  if (existsSync(rootEnvFile)) {
    process.loadEnvFile(rootEnvFile);
  }
  const { TEST_DATABASE_URL } = loadTestDatabaseEnv();
  const { APP_DATABASE_URL } = loadAppDatabaseEnv();
  const databaseUrl = new URL(TEST_DATABASE_URL);
  const name = decodeURIComponent(databaseUrl.pathname.slice(1));
  if (!testDatabaseName.test(name)) {
    throw new Error(
      `TEST_DATABASE_URL must point to a database whose name ends with _test, got "${name}"`,
    );
  }

  try {
    await createDatabaseIfMissing(databaseUrl, name);
  } catch (error) {
    throw new Error("Cannot reach the test database. Start it with `pnpm db:up`.", {
      cause: error,
    });
  }

  const { db, close } = connectDatabase(TEST_DATABASE_URL);
  try {
    await migrateDatabase(db);
    await configureAppRole(db, APP_DATABASE_URL);
  } finally {
    await close();
  }
  project.provide("testDatabaseUrl", TEST_DATABASE_URL);
  project.provide("testAppDatabaseUrl", asAppRole(databaseUrl, APP_DATABASE_URL));
}
