import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

import * as schema from "./schema.ts";

export type Database = NodePgDatabase<typeof schema>;

export interface DatabaseConnection {
  db: Database;
  close: () => Promise<void>;
}

export function connectDatabase(databaseUrl: string): DatabaseConnection {
  const pool = new Pool({ connectionString: databaseUrl });
  return {
    db: drizzle({ client: pool, schema }),
    close: () => pool.end(),
  };
}
