import type { MailboxCursor } from "@request-agent/core";

import { ImapFlow, type SearchObject } from "imapflow";
import { createTransport } from "nodemailer";

import type { Mailbox, MailSender } from "./adapter";

export interface MailServerSettings {
  user: string;
  password: string;
  address: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
  secure: boolean;
}

export interface MailLogger {
  error(message: string, error: unknown): void;
}

// Where the mailbox keeps how far it has read, so it goes on from there after a restart.
export interface CursorStore {
  load(): Promise<MailboxCursor | undefined>;
  save(cursor: MailboxCursor): Promise<void>;
}

// The emails to hand over: those that arrived after the cursor, read or not, since a person may
// have opened them in their mail client, and those still unread, such as an email that could not be
// stored before. Without a valid cursor, as on the first start, only the unread ones.
async function emailsToRead(
  client: ImapFlow,
  cursor: MailboxCursor | undefined,
  uidValidity: number,
): Promise<number[]> {
  const found = async (query: SearchObject) => {
    const uids = await client.search(query, { uid: true });
    return Array.isArray(uids) ? uids : [];
  };
  const unseen = await found({ seen: false });
  if (cursor === undefined || cursor.uidValidity !== uidValidity) {
    return unseen;
  }
  // "n:*" also matches the last email when its UID is below n (RFC 9051), hence the filter.
  const arrived = (await found({ uid: `${cursor.lastUid + 1}:*` })).filter(
    (uid) => uid > cursor.lastUid,
  );
  return [...new Set([...unseen, ...arrived])].toSorted((a, b) => a - b);
}

// Waits between two connection attempts, so a mail server that is down is not flooded.
const reconnectDelayMs = 10_000;

// IDLE starts after this inactivity, instead of 15 s by default, so a new email is read about a
// second after it arrives. The adapter's commands follow each other without pause, so the shorter
// delay does not interrupt them.
const autoIdleDelayMs = 1000;

// Watches the inbox over IMAP. The connection stays in IDLE, so a new email is read as soon as it
// arrives, and it is opened again when the server closes it.
export function imapMailbox(
  settings: MailServerSettings,
  logger: MailLogger,
  cursorStore: CursorStore,
): Mailbox & { close: () => Promise<void> } {
  let client: ImapFlow | undefined;
  let closed = false;
  return {
    watch: async (listener) => {
      // Reads the new emails one after the other, whatever triggered the read.
      let reading = Promise.resolve();
      const readNew = (current: ImapFlow) => {
        const read = async () => {
          if (current.mailbox === false) {
            return;
          }
          const uidValidity = Number(current.mailbox.uidValidity);
          const uids = await emailsToRead(current, await cursorStore.load(), uidValidity);
          for (const uid of uids) {
            // oxlint-disable-next-line no-await-in-loop
            const message = await current.fetchOne(String(uid), { source: true }, { uid: true });
            if (message !== false && message.source !== undefined) {
              // Emails are handed over one at a time, in the order of the mailbox.
              // oxlint-disable-next-line no-await-in-loop
              await listener({ uid, source: message.source });
            }
            // Saved once the email is handed over: after a crash, it is read again, and the
            // adapter recognizes it by its Message-ID.
            // oxlint-disable-next-line no-await-in-loop
            await cursorStore.save({ uidValidity, lastUid: uid });
          }
        };
        // A failed read does not stop the next ones: the emails stay unread and are read again.
        reading = reading.then(read, read);
        return reading;
      };

      const connect = async (): Promise<void> => {
        const current = new ImapFlow({
          host: settings.imapHost,
          port: settings.imapPort,
          secure: settings.secure,
          auth: { user: settings.user, pass: settings.password },
          autoIdleDelay: autoIdleDelayMs,
          logger: false,
        });
        current.on("error", (error: unknown) => {
          logger.error("IMAP connection error", error);
        });
        current.on("exists", () => {
          readNew(current).catch((error: unknown) => {
            logger.error("New emails could not be read", error);
          });
        });
        current.on("close", () => {
          if (closed) {
            return;
          }
          setTimeout(() => {
            connect().catch((error: unknown) => {
              logger.error("The mailbox could not be opened again", error);
            });
          }, reconnectDelayMs);
        });
        await current.connect();
        await current.mailboxOpen("INBOX");
        client = current;
        await readNew(current);
      };
      await connect();
    },
    markSeen: async (uid) => {
      if (client === undefined) {
        throw new Error("The mailbox is not open");
      }
      await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });
    },
    close: async () => {
      closed = true;
      await client?.logout();
    },
  };
}

// Sends the answers over SMTP, threaded under the email they answer.
export function smtpSender(settings: MailServerSettings): MailSender {
  const transport = createTransport({
    host: settings.smtpHost,
    port: settings.smtpPort,
    secure: settings.secure,
    auth: { user: settings.user, pass: settings.password },
  });
  return {
    send: async (email) => {
      const sent = await transport.sendMail({
        from: settings.address,
        to: email.to,
        subject: email.subject,
        text: email.text,
        inReplyTo: email.inReplyTo,
        references: email.references,
        // Marks the answer as automatic (RFC 3834), so other robots do not answer it back.
        headers: { "Auto-Submitted": "auto-replied" },
      });
      return { messageId: sent.messageId };
    },
  };
}
