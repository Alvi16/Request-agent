import { connectDatabase } from "../src/db/client.ts";
import { seedDatabase } from "../src/db/seed.ts";
import { loadDatabaseEnv } from "../src/env.ts";

const { DATABASE_URL } = loadDatabaseEnv();
const { db, close } = connectDatabase(DATABASE_URL);
try {
  await seedDatabase(db);
  console.info("Demo data inserted.");
} finally {
  await close();
}
