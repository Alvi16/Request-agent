import type { Database } from "../src/db/client.ts";
import { conversations, messages } from "../src/db/schema.ts";

export const alice = "alice.martin@acme.example";
export const bruno = "bruno.leroy@globex.example";
export const chloeSlackId = "U000000CHLOE";

interface StoredMessage {
  channel?: "SLACK" | "EMAIL";
  sender: string;
  bodyText: string;
  subject?: string;
  // Messages with the same thread belong to the same conversation.
  thread?: string;
}

let sequence = 0;

// Stores an inbound message the way a channel adapter will, and returns its ID.
export async function storeMessage(db: Database, message: StoredMessage): Promise<string> {
  sequence += 1;
  const channel = message.channel ?? "EMAIL";
  const thread = message.thread ?? `thread-${sequence}`;
  const [conversation] = await db
    .insert(conversations)
    .values({ channel, externalId: thread })
    .onConflictDoUpdate({
      target: [conversations.channel, conversations.externalId],
      set: { externalId: thread },
    })
    .returning({ id: conversations.id });
  if (conversation === undefined) {
    throw new Error("The conversation was not stored");
  }
  const [stored] = await db
    .insert(messages)
    .values({
      conversationId: conversation.id,
      channel,
      externalId: `message-${sequence}`,
      direction: "INBOUND",
      sender: message.sender,
      subject: message.subject ?? null,
      bodyText: message.bodyText,
      raw: {},
      sentAt: new Date(Date.UTC(2026, 9, 26, 9, sequence)),
    })
    .returning({ id: messages.id });
  if (stored === undefined) {
    throw new Error("The message was not stored");
  }
  return stored.id;
}
