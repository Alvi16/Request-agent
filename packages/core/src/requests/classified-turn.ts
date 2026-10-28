import { and, desc, eq, lt } from "drizzle-orm";

import type { Classification, Classifier } from "../classification/classifier.ts";
import type { Database } from "../db/client.ts";
import { messages, requests } from "../db/schema.ts";
import { visibleRequests } from "./access.ts";
import { formatReference } from "./reference.ts";
import type { Turn } from "./turn.ts";

// Earlier messages given to the classifier, so a reply such as "still the same problem" can be
// recognized as a follow-up. Bounded, since every message is text written by someone else.
const contextMessageCount = 4;
const contextMessageLength = 600;

// A turn whose message has been classified. Only code computes it: the language model receives the
// result and cannot change the type, the confidence or the review it leads to.
export interface ClassifiedTurn extends Turn {
  // Subject and body of the message, as the sender wrote them.
  messageText: string;
  classification: Classification;
  reviewThreshold: number;
}

// Earlier messages of the conversation, oldest first, and the request it is linked to, when the
// sender can reach it.
export async function conversationContext(db: Database, turn: Turn): Promise<string> {
  const [current] = await db
    .select({ conversationId: messages.conversationId, sentAt: messages.sentAt })
    .from(messages)
    .where(eq(messages.id, turn.messageId));
  if (current === undefined) {
    throw new Error(`Message ${turn.messageId} must be stored before the agent handles it`);
  }
  const earlier = await db
    .select({
      direction: messages.direction,
      bodyText: messages.bodyText,
      requestId: messages.requestId,
    })
    .from(messages)
    .where(
      and(eq(messages.conversationId, current.conversationId), lt(messages.sentAt, current.sentAt)),
    )
    .orderBy(desc(messages.sentAt))
    .limit(contextMessageCount);
  const lines = earlier.toReversed().map((message) => {
    const author = message.direction === "INBOUND" ? "Sender" : "Agent";
    return `${author}: ${message.bodyText.slice(0, contextMessageLength)}`;
  });

  const linkedRequestId = earlier.find((message) => message.requestId !== null)?.requestId;
  if (linkedRequestId !== undefined && linkedRequestId !== null) {
    const [request] = await db
      .select({ number: requests.number, title: requests.title, status: requests.status })
      .from(requests)
      .where(and(eq(requests.id, linkedRequestId), visibleRequests(turn.actor)));
    if (request !== undefined) {
      lines.push(
        `This conversation is linked to request ${formatReference(request.number)}: ` +
          `${request.title} (status ${request.status}).`,
      );
    }
  }
  return lines.join("\n");
}

export async function classifyTurn(
  db: Database,
  turn: Turn,
  options: { classify: Classifier; reviewThreshold: number },
): Promise<ClassifiedTurn> {
  const [message] = await db
    .select({ subject: messages.subject, bodyText: messages.bodyText })
    .from(messages)
    .where(eq(messages.id, turn.messageId));
  if (message === undefined) {
    throw new Error(`Message ${turn.messageId} must be stored before the agent handles it`);
  }
  const text =
    message.subject === null ? message.bodyText : `${message.subject}\n\n${message.bodyText}`;
  const classification = await options.classify({
    text,
    context: await conversationContext(db, turn),
  });
  return { ...turn, messageText: text, classification, reviewThreshold: options.reviewThreshold };
}

export type ReviewReason =
  | "LOW_CONFIDENCE"
  | "PROJECT_AMBIGUOUS"
  | "PROJECT_UNKNOWN"
  | "UNVERIFIED_SENDER"
  // The agent ended without filing the message, so the system filed it.
  | "UNHANDLED";

// Why a new request must wait for a person, given the project it is filed under. An empty list
// means the agent's decision can be trusted without review.
export function reviewReasons(turn: ClassifiedTurn, projectId: string | null): ReviewReason[] {
  const reasons: ReviewReason[] = [];
  if (turn.classification.confidence < turn.reviewThreshold) {
    reasons.push("LOW_CONFIDENCE");
  }
  if (turn.project.status === "ambiguous") {
    reasons.push("PROJECT_AMBIGUOUS");
  } else if (projectId === null) {
    reasons.push("PROJECT_UNKNOWN");
  }
  if (turn.actor.kind === "anonymous") {
    reasons.push("UNVERIFIED_SENDER");
  }
  return reasons;
}

// A confident OTHER, such as thanks or an advertisement, is not filed as a request. The message
// itself stays stored with its conversation.
export function isNotARequest(turn: ClassifiedTurn): boolean {
  return (
    turn.classification.type === "OTHER" && turn.classification.confidence >= turn.reviewThreshold
  );
}
