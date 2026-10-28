import { configureAppRole } from "../src/db/app-role.ts";
import { connectDatabase } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { loadAppDatabaseEnv, loadDatabaseEnv } from "../src/env.ts";

const { DATABASE_URL } = loadDatabaseEnv();
const { APP_DATABASE_URL } = loadAppDatabaseEnv();
const { db, close } = connectDatabase(DATABASE_URL);
try {
  await migrateDatabase(db);
  await configureAppRole(db, APP_DATABASE_URL);
  console.info("Database migrations applied and application role configured.");
} finally {
  await close();
}
