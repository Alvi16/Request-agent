import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ImapFlow } from "imapflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { type MailServerSettings, imapMailbox, smtpSender } from "./connect";
import { parseEmail } from "./parse";

// Runs against the local mail server started by `pnpm db:up`, on the mailbox kept for the tests.
const rootEnvFile = fileURLToPath(new URL("../../../../.env", import.meta.url));
if (existsSync(rootEnvFile)) {
  process.loadEnvFile(rootEnvFile);
}
const env = z
  .object({
    TEST_EMAIL_USER: z.string().min(1),
    TEST_EMAIL_PASSWORD: z.string().min(1),
    EMAIL_IMAP_HOST: z.string().default("127.0.0.1"),
    EMAIL_IMAP_PORT: z.coerce.number().default(3143),
    EMAIL_SMTP_HOST: z.string().default("127.0.0.1"),
    EMAIL_SMTP_PORT: z.coerce.number().default(3025),
  })
  .parse(process.env);

const settings: MailServerSettings = {
  user: env.TEST_EMAIL_USER,
  password: env.TEST_EMAIL_PASSWORD,
  address: `${env.TEST_EMAIL_USER}@requests.example`,
  imapHost: env.EMAIL_IMAP_HOST,
  imapPort: env.EMAIL_IMAP_PORT,
  smtpHost: env.EMAIL_SMTP_HOST,
  smtpPort: env.EMAIL_SMTP_PORT,
  secure: false,
};

async function emptyTestMailbox(): Promise<void> {
  const client = new ImapFlow({
    host: settings.imapHost,
    port: settings.imapPort,
    secure: false,
    auth: { user: settings.user, pass: settings.password },
    logger: false,
  });
  try {
    await client.connect();
  } catch (error) {
    throw new Error("Cannot reach the local mail server. Start it with `pnpm db:up`.", {
      cause: error,
    });
  }
  await client.mailboxOpen("INBOX");
  await client.messageDelete("1:*");
  await client.logout();
}

async function until<T>(read: () => T | undefined): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== undefined) {
      return value;
    }
    // Waiting for the server is sequential by nature.
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The email did not arrive in time");
}

describe("imapMailbox and smtpSender, against the local mail server", { timeout: 20_000 }, () => {
  const received: { uid: number; source: Uint8Array }[] = [];
  const mailbox = imapMailbox(settings, { error: () => {} });
  const sender = smtpSender(settings);

  beforeAll(async () => {
    await emptyTestMailbox();
    await mailbox.watch((mail) => {
      received.push(mail);
      return Promise.resolve();
    });
  });

  afterAll(async () => {
    await mailbox.close();
  });

  it("reads a new email as soon as it arrives, and answers it in its thread", async () => {
    await sender.send({
      to: settings.address,
      subject: "Bouton de validation cassé",
      text: "Le bouton de validation ne fonctionne plus.",
      inReplyTo: "<first@acme.example>",
      references: ["<first@acme.example>"],
    });

    const mail = await until(() => received[0]);
    const email = await parseEmail(mail.source);

    expect(email).toMatchObject({
      subject: "Bouton de validation cassé",
      inReplyTo: "<first@acme.example>",
      references: ["<first@acme.example>"],
    });
    expect(email.headers).toContainEqual({ key: "auto-submitted", value: "auto-replied" });
  });

  it("marks an email as read, so it is not read again", async () => {
    const mail = await until(() => received[0]);

    await mailbox.markSeen(mail.uid);

    const client = new ImapFlow({
      host: settings.imapHost,
      port: settings.imapPort,
      secure: false,
      auth: { user: settings.user, pass: settings.password },
      logger: false,
    });
    await client.connect();
    await client.mailboxOpen("INBOX");
    const unseen = await client.search({ seen: false });
    await client.logout();
    expect(unseen).toEqual([]);
  });
});
