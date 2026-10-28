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

const localHosts = new Set(["127.0.0.1", "localhost", "::1"]);

// Email is optional, like Slack: without an IMAP server, the server runs without it.
const emailEnvSchema = z
  .object({
    EMAIL_USER: z.string().min(1),
    EMAIL_PASSWORD: z.string().min(1),
    EMAIL_ADDRESS: z.email(),
    EMAIL_IMAP_HOST: z.string().min(1),
    EMAIL_IMAP_PORT: z.coerce.number().int().positive(),
    EMAIL_SMTP_HOST: z.string().min(1),
    EMAIL_SMTP_PORT: z.coerce.number().int().positive(),
    EMAIL_SECURE: z.stringbool().default(true),
    EMAIL_TRUSTED_AUTHSERV_ID: z.preprocess(
      (value) => (value === "" ? undefined : value),
      z.string().optional(),
    ),
    EMAIL_TRUST_LOCAL_SENDERS: z.stringbool().default(false),
  })
  .refine((env) => !env.EMAIL_TRUST_LOCAL_SENDERS || localHosts.has(env.EMAIL_IMAP_HOST), {
    message: "EMAIL_TRUST_LOCAL_SENDERS is only allowed with a mailbox on this machine",
    path: ["EMAIL_TRUST_LOCAL_SENDERS"],
  });

export type Env = z.infer<typeof envSchema>;
export type EmailEnv = z.infer<typeof emailEnvSchema>;
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

// The mailbox settings, or undefined when email is not configured.
export function loadEmailEnv(source: NodeJS.ProcessEnv = process.env): EmailEnv | undefined {
  if (source.EMAIL_IMAP_HOST === undefined || source.EMAIL_IMAP_HOST === "") {
    return undefined;
  }
  return parse(emailEnvSchema, source);
}
