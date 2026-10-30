import { and, asc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../db/client.ts";
import { conversations, messages } from "../db/schema.ts";

type Channel = (typeof messages.$inferSelect)["channel"];

// How many times a message is handled before the system stops retrying it.
export const maxHandlingAttempts = 3;

export interface UnhandledMessage {
  messageId: string;
  // The message and its conversation, as named by their channel.
  externalId: string;
  conversationExternalId: string;
  // Original payload stored by the channel adapter, from which the adapter can handle it again.
  raw: unknown;
  handlingAttempts: number;
}

// The system is done with an inbound message, whatever the outcome, so it is not handled again.
export async function markHandled(db: Database, messageId: string): Promise<void> {
  await db
    .update(messages)
    .set({ handledAt: new Date() })
    .where(and(eq(messages.id, messageId), isNull(messages.handledAt)));
}

// Records a failed attempt and returns how many attempts have failed so far.
export async function recordFailedAttempt(db: Database, messageId: string): Promise<number> {
  const [row] = await db
    .update(messages)
    .set({ handlingAttempts: sql`${messages.handlingAttempts} + 1` })
    .where(eq(messages.id, messageId))
    .returning({ attempts: messages.handlingAttempts });
  if (row === undefined) {
    throw new Error(`Message ${messageId} does not exist`);
  }
  return row.attempts;
}

// Inbound messages stored but not handled yet, oldest first: after a restart, the adapter of each
// channel handles them again.
export async function listUnhandledMessages(
  db: Database,
  channel: Channel,
): Promise<UnhandledMessage[]> {
  const rows = await db
    .select({
      messageId: messages.id,
      externalId: messages.externalId,
      conversationExternalId: conversations.externalId,
      raw: messages.raw,
      handlingAttempts: messages.handlingAttempts,
    })
    .from(messages)
    .innerJoin(conversations, eq(conversations.id, messages.conversationId))
    .where(
      and(
        eq(messages.channel, channel),
        eq(messages.direction, "INBOUND"),
        isNull(messages.handledAt),
      ),
    )
    .orderBy(asc(messages.receivedAt));
  return rows;
}
