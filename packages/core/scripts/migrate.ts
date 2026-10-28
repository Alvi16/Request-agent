import { connectDatabase } from "../src/db/client.ts";
import { migrateDatabase } from "../src/db/migrate.ts";
import { loadDatabaseEnv } from "../src/env.ts";

const { DATABASE_URL } = loadDatabaseEnv();
const { db, close } = connectDatabase(DATABASE_URL);
try {
  await migrateDatabase(db);
  console.info("Database migrations applied.");
} finally {
  await close();
}
