import { and, eq, sql } from "drizzle-orm";

import type { Database } from "../db/client.ts";
import { conversations, messages } from "../db/schema.ts";

type Channel = (typeof messages.$inferSelect)["channel"];

// A message as a channel adapter received or sent it.
export interface ChannelMessage {
  channel: Channel;
  // Slack thread or email thread the message belongs to.
  conversationExternalId: string;
  // Slack message or email Message-ID, unique on its channel.
  externalId: string;
  sender: string;
  subject?: string | null;
  bodyText: string;
  // Original payload, kept to always be able to go back to the source.
  raw: unknown;
  sentAt: Date;
  inReplyTo?: string | null;
}

export interface StoredMessage {
  messageId: string;
  // False when the channel delivered the same message again: it must not be handled twice.
  isNew: boolean;
}

async function storeMessage(
  db: Database,
  message: ChannelMessage,
  direction: "INBOUND" | "OUTBOUND",
): Promise<StoredMessage> {
  return db.transaction(async (tx) => {
    // The no-op update makes the row come back when the conversation already exists.
    const [conversation] = await tx
      .insert(conversations)
      .values({
        channel: message.channel,
        externalId: message.conversationExternalId,
        subject: message.subject ?? null,
      })
      .onConflictDoUpdate({
        target: [conversations.channel, conversations.externalId],
        set: { externalId: sql`excluded.external_id` },
      })
      .returning({ id: conversations.id });
    if (conversation === undefined) {
      throw new Error("The conversation was not stored");
    }
    const [inserted] = await tx
      .insert(messages)
      .values({
        conversationId: conversation.id,
        channel: message.channel,
        externalId: message.externalId,
        direction,
        sender: message.sender,
        subject: message.subject ?? null,
        bodyText: message.bodyText,
        raw: message.raw ?? {},
        inReplyTo: message.inReplyTo ?? null,
        sentAt: message.sentAt,
      })
      .onConflictDoNothing({ target: [messages.channel, messages.externalId] })
      .returning({ id: messages.id });
    if (inserted !== undefined) {
      return { messageId: inserted.id, isNew: true };
    }
    const [existing] = await tx
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(eq(messages.channel, message.channel), eq(messages.externalId, message.externalId)),
      );
    if (existing === undefined) {
      throw new Error("The message was neither inserted nor found");
    }
    return { messageId: existing.id, isNew: false };
  });
}

// Stores a received message with its conversation. Storing it again returns the same message,
// marked as not new, so a delivery repeated by the channel is handled once.
export function storeInboundMessage(db: Database, message: ChannelMessage): Promise<StoredMessage> {
  return storeMessage(db, message, "INBOUND");
}

// Stores an answer sent by the agent, so the conversation keeps both sides.
export function storeOutboundMessage(
  db: Database,
  message: ChannelMessage,
): Promise<StoredMessage> {
  return storeMessage(db, message, "OUTBOUND");
}

// Whether the system already follows this conversation, such as a Slack thread the agent took part in.
export async function isKnownConversation(
  db: Database,
  channel: Channel,
  conversationExternalId: string,
): Promise<boolean> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(
      and(eq(conversations.channel, channel), eq(conversations.externalId, conversationExternalId)),
    );
  return conversation !== undefined;
}
