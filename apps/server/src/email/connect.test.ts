import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { MailboxCursor } from "@request-agent/core";

import { ImapFlow } from "imapflow";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { type CursorStore, type MailServerSettings, imapMailbox, smtpSender } from "./connect";
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
    // Not the EMAIL_ settings of the agent, which may point to a real mailbox such as Gmail.
    TEST_EMAIL_HOST: z.string().default("127.0.0.1"),
    TEST_EMAIL_IMAP_PORT: z.coerce.number().default(3143),
    TEST_EMAIL_SMTP_PORT: z.coerce.number().default(3025),
  })
  .parse(process.env);

const settings: MailServerSettings = {
  user: env.TEST_EMAIL_USER,
  password: env.TEST_EMAIL_PASSWORD,
  address: `${env.TEST_EMAIL_USER}@requests.example`,
  imapHost: env.TEST_EMAIL_HOST,
  imapPort: env.TEST_EMAIL_IMAP_PORT,
  smtpHost: env.TEST_EMAIL_HOST,
  smtpPort: env.TEST_EMAIL_SMTP_PORT,
  secure: false,
};

// A client of the test mailbox, standing for a person or the tests themselves.
async function openTestMailbox(): Promise<ImapFlow> {
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
  return client;
}

async function emptyTestMailbox(): Promise<void> {
  const client = await openTestMailbox();
  await client.messageDelete("1:*");
  await client.logout();
}

// Sends an email to the test mailbox and waits until the server has it.
async function deliver(subject: string): Promise<void> {
  const client = await openTestMailbox();
  const before = client.mailbox === false ? 0 : client.mailbox.exists;
  await smtpSender(settings).send({
    to: settings.address,
    subject,
    text: "Le bouton de validation ne fonctionne plus.",
    inReplyTo: "<first@acme.example>",
    references: ["<first@acme.example>"],
  });
  await until(async () => {
    const status = await client.status("INBOX", { messages: true });
    return status !== false && (status.messages ?? 0) > before ? true : undefined;
  });
  await client.logout();
}

// What a person does when they open every email in their mail client.
async function openAllEmails(): Promise<void> {
  const client = await openTestMailbox();
  await client.messageFlagsAdd("1:*", ["\\Seen"]);
  await client.logout();
}

function memoryCursorStore(): CursorStore & { cursor: MailboxCursor | undefined } {
  const store = {
    cursor: undefined as MailboxCursor | undefined,
    load: () => Promise.resolve(store.cursor),
    save: (cursor: MailboxCursor) => {
      store.cursor = cursor;
      return Promise.resolve();
    },
  };
  return store;
}

async function until<T>(read: () => T | undefined | Promise<T | undefined>): Promise<T> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    // oxlint-disable-next-line no-await-in-loop
    const value = await read();
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
  const mailbox = imapMailbox(settings, { error: () => {} }, memoryCursorStore());
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

    const client = await openTestMailbox();
    const unseen = await client.search({ seen: false });
    await client.logout();
    expect(unseen).toEqual([]);
  });
});

async function subjectsOf(received: { source: Uint8Array }[]) {
  return Promise.all(received.map(async (mail) => (await parseEmail(mail.source)).subject));
}

// Starts a mailbox like the agent does at startup, keeps what it hands over, then stops it.
async function watchOnce(store: CursorStore) {
  const received: { uid: number; source: Uint8Array }[] = [];
  const mailbox = imapMailbox(settings, { error: () => {} }, store);
  await mailbox.watch((mail) => {
    received.push(mail);
    return Promise.resolve();
  });
  await mailbox.close();
  return received;
}

describe("imapMailbox, after a restart", { timeout: 30_000 }, () => {
  beforeAll(async () => {
    await emptyTestMailbox();
  });

  it("hands over an email that a person opened before the agent read it", async () => {
    const store = memoryCursorStore();
    await deliver("Avant l'arrêt");
    expect(await subjectsOf(await watchOnce(store))).toEqual(["Avant l'arrêt"]);
    await openAllEmails();

    await deliver("Ouvert par une personne");
    await openAllEmails();

    expect(await subjectsOf(await watchOnce(store))).toEqual(["Ouvert par une personne"]);
  });

  it("reads only the unread emails on the first start", async () => {
    await deliver("Encore non lu");

    expect(await subjectsOf(await watchOnce(memoryCursorStore()))).toEqual(["Encore non lu"]);
  });
});
