import { z } from "zod";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

const databaseEnvSchema = z.object({ DATABASE_URL: postgresUrl });
const testDatabaseEnvSchema = z.object({ TEST_DATABASE_URL: postgresUrl });

export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type TestDatabaseEnv = z.infer<typeof testDatabaseEnvSchema>;

function parseEnv<T>(schema: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadDatabaseEnv(source: NodeJS.ProcessEnv = process.env): DatabaseEnv {
  return parseEnv(databaseEnvSchema, source);
}

export function loadTestDatabaseEnv(source: NodeJS.ProcessEnv = process.env): TestDatabaseEnv {
  return parseEnv(testDatabaseEnvSchema, source);
}
