import { and, asc, eq, inArray } from "drizzle-orm";

import type { Database } from "../db/client.ts";
import { attachments, conversations, events, messages, requests } from "../db/schema.ts";
import { formatReference } from "../requests/reference.ts";

type Channel = (typeof messages.$inferSelect)["channel"];

export interface ConversationThread {
  messages: { fromAgent: boolean; text: string; sentAt: string; attachments: string[] }[];
  // The requests created from a message of the conversation, with their current status.
  requests: {
    reference: string;
    title: string;
    status: (typeof requests.$inferSelect)["status"];
  }[];
  // True while a message of the person waits for the agent.
  waiting: boolean;
}

async function findConversation(
  db: Database,
  channel: Channel,
  externalId: string,
): Promise<string | undefined> {
  const [conversation] = await db
    .select({ id: conversations.id })
    .from(conversations)
    .where(and(eq(conversations.channel, channel), eq(conversations.externalId, externalId)));
  return conversation?.id;
}

// A conversation as the person who holds it sees it: their messages, the answers of the agent, and
// the requests their messages created. A request their message was only added to, such as the
// request of another person that their message repeats, is not shown: it is not theirs.
export async function readConversation(
  db: Database,
  channel: Channel,
  externalId: string,
): Promise<ConversationThread | undefined> {
  const conversationId = await findConversation(db, channel, externalId);
  if (conversationId === undefined) {
    return undefined;
  }
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      bodyText: messages.bodyText,
      sentAt: messages.sentAt,
      handledAt: messages.handledAt,
    })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(asc(messages.sentAt), asc(messages.id));
  const ids = rows.map((row) => row.id);
  const [files, created] =
    ids.length === 0
      ? [[], []]
      : await Promise.all([
          db
            .select({ messageId: attachments.messageId, filename: attachments.filename })
            .from(attachments)
            .where(inArray(attachments.messageId, ids))
            .orderBy(asc(attachments.createdAt)),
          db
            .select({ number: requests.number, title: requests.title, status: requests.status })
            .from(events)
            .innerJoin(requests, eq(requests.id, events.requestId))
            .where(and(eq(events.type, "CREATED"), inArray(events.messageId, ids)))
            .orderBy(asc(requests.number)),
        ]);
  return {
    messages: rows.map((row) => ({
      fromAgent: row.direction === "OUTBOUND",
      text: row.bodyText,
      sentAt: row.sentAt.toISOString(),
      attachments: files.filter((file) => file.messageId === row.id).map((file) => file.filename),
    })),
    requests: created.map((row) => ({
      reference: formatReference(row.number),
      title: row.title,
      status: row.status,
    })),
    waiting: rows.some((row) => row.direction === "INBOUND" && row.handledAt === null),
  };
}

// The sender of the first message of a conversation, and what its channel kept with it, so a
// reply in the same conversation keeps the same person.
export async function conversationOrigin(
  db: Database,
  channel: Channel,
  externalId: string,
): Promise<{ sender: string; raw: unknown } | undefined> {
  const conversationId = await findConversation(db, channel, externalId);
  if (conversationId === undefined) {
    return undefined;
  }
  const [first] = await db
    .select({ sender: messages.sender, raw: messages.raw })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), eq(messages.direction, "INBOUND")))
    .orderBy(asc(messages.sentAt), asc(messages.id))
    .limit(1);
  return first;
}
