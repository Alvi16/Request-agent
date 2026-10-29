import {
  conversationOfMessage,
  listUnhandledMessages,
  markHandled,
  type Database,
  storeInboundMessage,
  storeOutboundMessage,
  type TurnInput,
} from "@request-agent/core";

import { z } from "zod";

import type { HandledMessage } from "../mastra/agents/handle-message";
import { createSerialQueue, defaultRetryDelaysMs, handleReliably } from "../reliable-handling";
import { type ParsedEmail, parseEmail } from "./parse";
import { isAutomatic, senderTrust, type TrustSettings } from "./policy";

// The parts of the mail clients the adapter uses, so tests can replace them.
export interface Mailbox {
  // Calls the listener for every unread email, then for each new one as it arrives.
  watch(listener: (mail: { uid: number; source: Uint8Array }) => Promise<void>): Promise<void>;
  markSeen(uid: number): Promise<void>;
}

export interface OutgoingEmail {
  to: string;
  subject: string;
  text: string;
  inReplyTo: string;
  references: string[];
}

export interface MailSender {
  send(email: OutgoingEmail): Promise<{ messageId: string }>;
}

export interface EmailAdapterLogger {
  info(message: string): void;
  error(message: string, error: unknown): void;
}

export interface EmailAdapterOptions {
  mailbox: Mailbox;
  sender: MailSender;
  db: Database;
  // Runs the agent on a stored message: handleMessage, bound to the agent and the classifier.
  handle: (input: TurnInput) => Promise<HandledMessage>;
  // Address the agent receives and answers from.
  address: string;
  trust: TrustSettings;
  logger: EmailAdapterLogger;
  // Waits before handling a failed email again, after the first and second failures.
  retryDelaysMs?: number[];
}

// Sent when an email could not even be filed for a person, for example when the database is down.
// The email stays unhandled and is handled again when the server restarts.
export const unavailableReply =
  "Le service est momentanément indisponible et votre message n'a pas pu être traité. Merci de le renvoyer un peu plus tard.";

const storedSource = z.object({ source: z.string() });

// The thread an email belongs to, named after its first message. A reply that lost its References
// header is still attached through the message it answers.
async function threadOf(db: Database, email: ParsedEmail): Promise<string> {
  const [root] = email.references;
  if (root !== undefined) {
    return root;
  }
  if (email.inReplyTo !== null) {
    return (await conversationOfMessage(db, "EMAIL", email.inReplyTo)) ?? email.inReplyTo;
  }
  return email.messageId;
}

// Keeps one "Re:" and adds the request reference, so people and mail clients follow the thread.
function replySubject(subject: string | null, reply: string): string {
  const base = (subject ?? "").replace(/^(\s*(re|tr|fw|fwd)\s*:\s*)+/i, "").trim();
  const reference = /REQ-\d{1,9}/.exec(reply)?.[0];
  const tagged =
    reference === undefined || base.includes(reference) ? base : `${base} [${reference}]`;
  return `Re: ${tagged}`.trim();
}

// Connects a mailbox to the agent. Each email is stored before it is marked as read, so a read
// email is never lost, then handled one at a time, since the model runs on a CPU.
export async function startEmailAdapter(options: EmailAdapterOptions): Promise<{
  idle: () => Promise<void>;
}> {
  const { db, logger } = options;
  const queue = createSerialQueue();

  async function reply(email: ParsedEmail, thread: string, text: string): Promise<void> {
    const sent = await options.sender.send({
      to: email.from,
      subject: replySubject(email.subject, text),
      text,
      inReplyTo: email.messageId,
      references: [...email.references, email.messageId],
    });
    await storeOutboundMessage(db, {
      channel: "EMAIL",
      conversationExternalId: thread,
      externalId: sent.messageId,
      sender: options.address,
      subject: replySubject(email.subject, text),
      bodyText: text,
      raw: { to: email.from },
      sentAt: new Date(),
      inReplyTo: email.messageId,
    });
  }

  async function process(email: ParsedEmail, thread: string, messageId: string): Promise<void> {
    const ownAddress = options.address.toLowerCase();
    try {
      const outcome = await handleReliably(
        db,
        options.handle,
        {
          messageId,
          trust: senderTrust(email, options.trust),
          // An address dedicated to a project, such as one forwarded to the agent's mailbox.
          channelAddress: email.recipients.find((address) => address !== ownAddress) ?? ownAddress,
        },
        options.retryDelaysMs ?? defaultRetryDelaysMs,
      );
      if (outcome.kind === "retry") {
        logger.error(`Email ${email.messageId} will be handled again`, outcome.error);
        queue.later(outcome.delayMs, () => process(email, thread, messageId));
        return;
      }
      if (outcome.reply !== null) {
        await reply(email, thread, outcome.reply);
      }
    } catch (error) {
      logger.error(`Email ${email.messageId} could not be handled`, error);
      await reply(email, thread, unavailableReply).catch((replyError: unknown) => {
        logger.error("The unavailability reply could not be sent", replyError);
      });
    }
  }

  async function receive(mail: { uid: number; source: Uint8Array }): Promise<void> {
    const email = await parseEmail(mail.source);
    const thread = await threadOf(db, email);
    const stored = await storeInboundMessage(db, {
      channel: "EMAIL",
      conversationExternalId: thread,
      externalId: email.messageId,
      sender: email.from,
      subject: email.subject,
      bodyText: email.text,
      // The original email, so the request can always go back to the source.
      raw: {
        source: Buffer.from(mail.source).toString("base64"),
        headers: email.headers,
        recipients: email.recipients,
        attachments: email.attachments,
      },
      sentAt: email.sentAt,
      inReplyTo: email.inReplyTo,
      attachments: email.attachments,
    });
    if (stored.isNew) {
      // Automatic replies and mailing lists are kept, but neither handled nor answered.
      if (isAutomatic(email, options.address)) {
        await markHandled(db, stored.messageId);
      } else {
        queue.push(() => process(email, thread, stored.messageId));
      }
    }
    await options.mailbox.markSeen(mail.uid);
  }

  // Emails stored before a restart but never handled are handled first, from their original source.
  async function recoverUnhandled(): Promise<void> {
    const unhandled = await listUnhandledMessages(db, "EMAIL");
    const prepared = await Promise.all(
      unhandled.map(async (stored) => {
        const source = storedSource.safeParse(stored.raw);
        if (!source.success) {
          // Stored by an earlier version, without its source: it cannot be read again.
          await markHandled(db, stored.messageId);
          return undefined;
        }
        const email = await parseEmail(Buffer.from(source.data.source, "base64"));
        return { email, thread: await threadOf(db, email), messageId: stored.messageId };
      }),
    );
    // Queued in their order, oldest first.
    for (const item of prepared) {
      if (item !== undefined) {
        queue.push(() => process(item.email, item.thread, item.messageId));
      }
    }
  }

  // A database that is down at startup does not stop the channel: the messages stay unhandled and
  // are handled again at the next start.
  await recoverUnhandled().catch((error: unknown) => {
    logger.error("Unhandled messages could not be resumed", error);
  });

  return options.mailbox
    .watch(async (mail) => {
      try {
        await receive(mail);
      } catch (error) {
        // Left unread, so it is read again at the next start and not lost.
        logger.error(`Email ${mail.uid} could not be stored`, error);
      }
    })
    .then(() => {
      logger.info("Email adapter listening");
      return { idle: queue.idle };
    });
}
