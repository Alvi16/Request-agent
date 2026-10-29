import { getTableName, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, inject } from "vitest";

import { connectDatabase, type Database, type DatabaseConnection } from "../src/db/client.ts";
import * as schema from "../src/db/schema.ts";

// Values given by the global setup to every test file.
declare module "vitest" {
  export interface ProvidedContext {
    testDatabaseUrl: string;
    testAppDatabaseUrl: string;
  }
}

const tables = [
  schema.staffSessions,
  schema.staffAccounts,
  schema.attachments,
  schema.events,
  schema.messages,
  schema.conversations,
  schema.requests,
  schema.projectChannels,
  schema.projectContacts,
  schema.projects,
  schema.contacts,
  schema.organizations,
];

// Connects to the test database for the current file and empties it before each test.
export function useTestDatabase(): () => Database {
  let connection: DatabaseConnection | undefined;

  beforeAll(() => {
    connection = connectDatabase(inject("testDatabaseUrl"));
  });

  beforeEach(async () => {
    const names = tables.map((table) => `"${getTableName(table)}"`).join(", ");
    await getDatabase().execute(sql.raw(`truncate ${names} restart identity`));
  });

  afterAll(async () => {
    await connection?.close();
  });

  function getDatabase(): Database {
    if (connection === undefined) {
      throw new Error("The test database is only available inside tests");
    }
    return connection.db;
  }

  return getDatabase;
}

// Connects to the same test database with the restricted application role. Use it next to
// useTestDatabase, which empties the tables, to run the code under test with its real rights.
export function useAppTestDatabase(): () => Database {
  let connection: DatabaseConnection | undefined;

  beforeAll(() => {
    connection = connectDatabase(inject("testAppDatabaseUrl"));
  });

  afterAll(async () => {
    await connection?.close();
  });

  return () => {
    if (connection === undefined) {
      throw new Error("The test database is only available inside tests");
    }
    return connection.db;
  };
}
