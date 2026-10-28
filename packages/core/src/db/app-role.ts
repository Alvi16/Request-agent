import { sql } from "drizzle-orm";
import { escapeLiteral } from "pg";

import { appRole } from "../env.ts";
import type { Database } from "./client.ts";

// Lets the application role log in with the password of its URL. The migrations create the role
// without a password, because a secret must never be stored in a migration.
export async function configureAppRole(db: Database, appDatabaseUrl: string): Promise<void> {
  const password = decodeURIComponent(new URL(appDatabaseUrl).password);
  if (password === "") {
    throw new Error(`The ${appRole} role needs a password`);
  }
  // ALTER ROLE does not accept query parameters, so the password is escaped as a literal.
  await db.execute(
    sql.raw(`alter role "${appRole}" with login password ${escapeLiteral(password)}`),
  );
}
