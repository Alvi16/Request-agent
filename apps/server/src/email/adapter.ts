import {
  conversationOfMessage,
  type Database,
  storeInboundMessage,
  storeOutboundMessage,
  type TurnInput,
} from "@request-agent/core";

import type { HandledMessage } from "../mastra/agents/handle-message";
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
}

// Sent when the agent could not handle an email. Nothing retries it yet, so the sender is asked to
// send it again.
export const unavailableReply =
  "Le service est momentanément indisponible et votre message n'a pas pu être traité. Merci de le renvoyer un peu plus tard.";

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
export function startEmailAdapter(options: EmailAdapterOptions): Promise<{
  idle: () => Promise<void>;
}> {
  const { db, logger } = options;
  let queue = Promise.resolve();

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
      const handled = await options.handle({
        messageId,
        trust: senderTrust(email, options.trust),
        // An address dedicated to a project, such as one forwarded to the agent's mailbox.
        channelAddress: email.recipients.find((address) => address !== ownAddress) ?? ownAddress,
      });
      if (handled.reply !== null) {
        await reply(email, thread, handled.reply);
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
        headers: email.headers,
        recipients: email.recipients,
        text: email.fullText,
        attachments: email.attachments,
      },
      sentAt: email.sentAt,
      inReplyTo: email.inReplyTo,
      attachments: email.attachments,
    });
    // Automatic replies and mailing lists are kept, but neither handled nor answered.
    if (stored.isNew && !isAutomatic(email, options.address)) {
      queue = queue.then(() => process(email, thread, stored.messageId));
    }
    await options.mailbox.markSeen(mail.uid);
  }

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
      return { idle: () => queue };
    });
}
