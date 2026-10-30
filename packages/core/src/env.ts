import { z } from "zod";

const postgresUrl = z.url({ protocol: /^postgres(ql)?$/ });

// Database role of the application, created by the migrations with restricted rights.
export const appRole = "request_agent_app";

const appDatabaseUrl = postgresUrl.refine(
  (value) => {
    const url = new URL(value);
    return url.username === appRole && url.password !== "";
  },
  { message: `Must connect as the ${appRole} role, with a password` },
);

const databaseEnvSchema = z.object({ DATABASE_URL: postgresUrl });
const appDatabaseEnvSchema = z.object({ APP_DATABASE_URL: appDatabaseUrl });
const testDatabaseEnvSchema = z.object({ TEST_DATABASE_URL: postgresUrl });

// Below this confidence, a classified request waits for a human review. 0.8 was measured on the
// evaluation messages: see docs/agent.md.
const defaultReviewThreshold = 0.8;

const classifierEnvSchema = z.object({
  OLLAMA_BASE_URL: z.url(),
  OLLAMA_MODEL: z.string().min(1),
  CLASSIFICATION_REVIEW_THRESHOLD: z.coerce.number().min(0).max(1).default(defaultReviewThreshold),
});

// Model that turns help articles and questions into vectors, chosen in decision 010.
const defaultEmbeddingModel = "qwen3-embedding:0.6b";

const knowledgeEnvSchema = z.object({
  OLLAMA_BASE_URL: z.url(),
  OLLAMA_EMBEDDING_MODEL: z.string().min(1).default(defaultEmbeddingModel),
});

export type ClassifierEnv = z.infer<typeof classifierEnvSchema>;
export type KnowledgeEnv = z.infer<typeof knowledgeEnvSchema>;
export type DatabaseEnv = z.infer<typeof databaseEnvSchema>;
export type AppDatabaseEnv = z.infer<typeof appDatabaseEnvSchema>;
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

export function loadAppDatabaseEnv(source: NodeJS.ProcessEnv = process.env): AppDatabaseEnv {
  return parseEnv(appDatabaseEnvSchema, source);
}

export function loadTestDatabaseEnv(source: NodeJS.ProcessEnv = process.env): TestDatabaseEnv {
  return parseEnv(testDatabaseEnvSchema, source);
}

export function loadClassifierEnv(source: NodeJS.ProcessEnv = process.env): ClassifierEnv {
  return parseEnv(classifierEnvSchema, source);
}

export function loadKnowledgeEnv(source: NodeJS.ProcessEnv = process.env): KnowledgeEnv {
  return parseEnv(knowledgeEnvSchema, source);
}
