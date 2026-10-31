import { isAbsolute } from "node:path";

import { loadAppDatabaseEnv } from "@request-agent/core";
import { z } from "zod";

function isTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: zone }).format();
    return true;
  } catch {
    return false;
  }
}

const webEnvSchema = z.object({
  // Only this machine by default: set 0.0.0.0 to open the interface to the network, behind HTTPS.
  WEB_HOST: z.string().min(1).default("127.0.0.1"),
  WEB_PORT: z.coerce.number().int().min(1).max(65_535).default(4112),
  // Folder where the widget writes the files people attach, the same as for the agent server.
  // Optional: without it, the files are listed but cannot be downloaded.
  ATTACHMENTS_DIR: z.preprocess(
    (value) => (value === "" ? undefined : value),
    z.string().refine(isAbsolute, { message: "Must be an absolute path" }).optional(),
  ),
  // Time zone of the dates shown to the team, as an IANA name.
  WEB_TIME_ZONE: z
    .string()
    .default("Europe/Paris")
    .refine(isTimeZone, { message: "Must be an IANA time zone, such as Europe/Paris" }),
});

export type WebEnv = z.infer<typeof webEnvSchema> & { APP_DATABASE_URL: string };

export function loadWebEnv(source: NodeJS.ProcessEnv = process.env): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (!result.success) {
    throw new Error(`Invalid environment configuration:\n${z.prettifyError(result.error)}`);
  }
  return { ...result.data, ...loadAppDatabaseEnv(source) };
}
