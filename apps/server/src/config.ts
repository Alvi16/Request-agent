import { z } from "zod";

const envSchema = z.object({
  OLLAMA_BASE_URL: z.url(),
  OLLAMA_MODEL: z.string().min(1),
});

// An empty value in .env means the variable is not set.
const optionalToken = (prefix: string) =>
  z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().startsWith(prefix, `Must start with ${prefix}`).optional(),
  );

// Slack is optional: without its two tokens, the server runs without it. With only one of them,
// the configuration is a mistake.
const slackEnvSchema = z
  .object({
    SLACK_BOT_TOKEN: optionalToken("xoxb-"),
    SLACK_APP_TOKEN: optionalToken("xapp-"),
  })
  .refine((env) => (env.SLACK_BOT_TOKEN === undefined) === (env.SLACK_APP_TOKEN === undefined), {
    message: "SLACK_BOT_TOKEN and SLACK_APP_TOKEN must be set together",
  });

export type Env = z.infer<typeof envSchema>;
export interface SlackTokens {
  botToken: string;
  appToken: string;
}

function parse<T>(schema: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return parse(envSchema, source);
}

// The Slack tokens, or undefined when Slack is not configured.
export function loadSlackTokens(source: NodeJS.ProcessEnv = process.env): SlackTokens | undefined {
  const env = parse(slackEnvSchema, source);
  if (env.SLACK_BOT_TOKEN === undefined || env.SLACK_APP_TOKEN === undefined) {
    return undefined;
  }
  return { botToken: env.SLACK_BOT_TOKEN, appToken: env.SLACK_APP_TOKEN };
}
