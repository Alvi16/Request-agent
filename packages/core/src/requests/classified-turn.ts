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
const unclassifiedTitleLength = 80;

// A turn whose message has been classified. Only code computes it: the language model receives the
// result and cannot change the type, the confidence or the review it leads to.
// An existing request the message may be about, with the confidence of the model in it.
export interface PossibleDuplicate {
  reference: string;
  confidence: number;
}

export interface ClassifiedTurn extends Turn {
  // Subject and body of the message, as the sender wrote them.
  messageText: string;
  classification: Classification;
  reviewThreshold: number;
  // Set only when the model named an existing request: null otherwise.
  duplicate: PossibleDuplicate | null;
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
  return {
    ...turn,
    messageText: text,
    classification,
    reviewThreshold: options.reviewThreshold,
    duplicate: null,
  };
}

// A turn for a message the model could not classify, for example while Ollama is down: filed as
// OTHER with no confidence, so it waits for a person instead of being lost.
export async function unclassifiedTurn(db: Database, turn: Turn): Promise<ClassifiedTurn> {
  const [message] = await db
    .select({ subject: messages.subject, bodyText: messages.bodyText })
    .from(messages)
    .where(eq(messages.id, turn.messageId));
  if (message === undefined) {
    throw new Error(`Message ${turn.messageId} must be stored before the agent handles it`);
  }
  const text =
    message.subject === null ? message.bodyText : `${message.subject}\n\n${message.bodyText}`;
  return {
    ...turn,
    messageText: text,
    reviewThreshold: 1,
    duplicate: null,
    classification: {
      type: "OTHER",
      priority: null,
      title:
        (message.subject ?? message.bodyText).slice(0, unclassifiedTitleLength).trim() ||
        "(no title)",
      summary: "",
      confidence: 0,
      model: "none",
      promptVersion: "none",
    },
  };
}

export type ReviewReason =
  | "LOW_CONFIDENCE"
  | "PROJECT_AMBIGUOUS"
  | "PROJECT_UNKNOWN"
  | "UNVERIFIED_SENDER"
  // The message may be about an existing request, without enough confidence to merge them.
  | "POSSIBLE_DUPLICATE"
  // The agent ended without filing the message, so the system filed it.
  | "UNHANDLED"
  // The agent passed a question or a wish of the sender that it cannot answer to the team.
  | "QUESTION_FOR_TEAM";

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
  if (turn.duplicate !== null && turn.duplicate.confidence < turn.reviewThreshold) {
    reasons.push("POSSIBLE_DUPLICATE");
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
