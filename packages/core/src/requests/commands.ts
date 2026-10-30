import { and, count, eq } from "drizzle-orm";

import type { Database, Transaction } from "../db/client.ts";
import { events, messages, projects, requests } from "../db/schema.ts";
import { visibleRequests, worksOnProject } from "./access.ts";
import {
  type ClassifiedTurn,
  isNotARequest,
  type ReviewReason,
  reviewReasons,
} from "./classified-turn.ts";
import type {
  CreateRequestInput,
  ForwardToTeamInput,
  RequestClarificationInput,
  RequestReferenceInput,
  UpdateRequestInput,
} from "./inputs.ts";
import { findConversationRequestId } from "./queries.ts";
import { parseReference } from "./reference.ts";
import { assignableProjectIds, type Turn } from "./turn.ts";
import {
  fail,
  type RequestView,
  type Result,
  selectRequestViews,
  succeed,
  toRequestView,
} from "./views.ts";

// Locks the message being handled, so two attempts to handle it cannot both file a request.
async function lockTurnMessage(tx: Transaction, turn: Turn) {
  const [message] = await tx
    .select({ id: messages.id, channel: messages.channel, requestId: messages.requestId })
    .from(messages)
    .where(eq(messages.id, turn.messageId))
    .for("update");
  if (message === undefined) {
    throw new Error(`Message ${turn.messageId} must be stored before the agent handles it`);
  }
  return message;
}

async function findProjectId(tx: Transaction, key: string): Promise<string | undefined> {
  const [project] = await tx
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.key, key.toUpperCase()));
  return project?.id;
}

async function loadView(tx: Transaction, requestId: string): Promise<RequestView> {
  const [row] = await selectRequestViews(tx, eq(requests.id, requestId));
  if (row === undefined) {
    throw new Error(`Request ${requestId} disappeared during the transaction`);
  }
  return toRequestView(row);
}

// Finds a request the actor may reach, by reference, and locks it for the update that follows.
async function lockVisibleRequest(tx: Transaction, turn: Turn, reference: string) {
  const requestNumber = parseReference(reference);
  if (requestNumber === undefined) {
    return undefined;
  }
  const [request] = await tx
    .select()
    .from(requests)
    .where(and(eq(requests.number, requestNumber), visibleRequests(turn.actor)))
    .for("update");
  return request;
}

// Longest description stored, matching what the request operations accept.
const descriptionLength = 10_000;

// How many times the agent may ask the sender for details on one request. After that, a person
// takes over, so the agent cannot keep a sender in a loop of questions.
export const maxClarifications = 2;

export interface CreatedRequest {
  request: RequestView;
  // False when the message had already been filed: the existing request is returned instead.
  created: boolean;
  // True when the message was added to an existing request about the same problem.
  duplicate: boolean;
}

type TurnMessage = Awaited<ReturnType<typeof lockTurnMessage>>;
type RequestStatus = (typeof requests.$inferSelect)["status"];

// The project a new request is filed under: the one asked for, when the sender may use it, or the
// one identified by the rules.
async function resolveNewRequestProject(
  tx: Transaction,
  turn: ClassifiedTurn,
  projectKey: string | undefined,
): Promise<Result<string | null, "PROJECT_NOT_ALLOWED">> {
  if (projectKey === undefined) {
    return succeed(turn.project.status === "identified" ? turn.project.projectId : null);
  }
  const found = await findProjectId(tx, projectKey);
  if (found === undefined || !assignableProjectIds(turn).includes(found)) {
    return fail("PROJECT_NOT_ALLOWED");
  }
  return succeed(found);
}

// Files the message as a new request from its classification, with the history of the decision.
async function insertRequest(
  tx: Transaction,
  turn: ClassifiedTurn,
  message: TurnMessage,
  projectId: string | null,
  status: RequestStatus,
  extraReasons: ReviewReason[] = [],
  duplicateOf?: string,
): Promise<string> {
  const { classification } = turn;
  const reasons = [...reviewReasons(turn, projectId), ...extraReasons];
  const [request] = await tx
    .insert(requests)
    .values({
      projectId,
      requesterContactId: turn.actor.kind === "contact" ? turn.actor.contactId : null,
      type: classification.type,
      status,
      priority: classification.priority,
      title: classification.title,
      summary: classification.summary || null,
      // The message itself describes the request best: rewriting it would cost time and could
      // change its meaning, so the description keeps the sender's words.
      description: turn.messageText.slice(0, descriptionLength),
      sourceChannel: message.channel,
      confidence: classification.confidence,
      needsReview: reasons.length > 0 || status === "WAITING_FOR_INFO",
      duplicateOfRequestId: duplicateOf ?? null,
    })
    .returning({ id: requests.id });
  if (request === undefined) {
    throw new Error("The request was not inserted");
  }
  await tx.update(messages).set({ requestId: request.id }).where(eq(messages.id, message.id));

  const origin = {
    requestId: request.id,
    actorType: "AGENT" as const,
    channel: message.channel,
    messageId: message.id,
  };
  await tx.insert(events).values([
    { ...origin, type: "CREATED", data: { title: classification.title, status } },
    {
      ...origin,
      type: "CLASSIFIED",
      data: {
        type: classification.type,
        priority: classification.priority,
        confidence: classification.confidence,
        threshold: turn.reviewThreshold,
        reviewReasons: reasons,
        model: classification.model,
        promptVersion: classification.promptVersion,
      },
    },
  ]);
  return request.id;
}

export function createRequest(
  db: Database,
  turn: ClassifiedTurn,
  input: CreateRequestInput,
): Promise<Result<CreatedRequest, "PROJECT_NOT_ALLOWED" | "PROJECT_AMBIGUOUS" | "NOT_A_REQUEST">> {
  return db.transaction(async (tx) => {
    const message = await lockTurnMessage(tx, turn);
    if (message.requestId !== null) {
      return succeed({
        request: await loadView(tx, message.requestId),
        created: false,
        duplicate: false,
      });
    }
    if (isNotARequest(turn)) {
      return fail("NOT_A_REQUEST");
    }
    // A verified sender can say which project they mean: the agent must ask instead of guessing.
    if (turn.actor.kind === "contact" && turn.project.status === "ambiguous") {
      return fail("PROJECT_AMBIGUOUS");
    }
    const project = await resolveNewRequestProject(tx, turn, input.projectKey);
    if (!project.ok) {
      return project;
    }
    const duplicateOf =
      turn.duplicate === null
        ? undefined
        : await lockVisibleRequest(tx, turn, turn.duplicate.reference);
    // A confident duplicate gets the message instead of a second request about the same problem.
    if (
      turn.duplicate !== null &&
      duplicateOf !== undefined &&
      turn.duplicate.confidence >= turn.reviewThreshold
    ) {
      await tx
        .update(messages)
        .set({ requestId: duplicateOf.id })
        .where(eq(messages.id, message.id));
      await tx
        .update(requests)
        .set({ updatedAt: new Date() })
        .where(eq(requests.id, duplicateOf.id));
      await tx.insert(events).values({
        requestId: duplicateOf.id,
        type: "MESSAGE_ADDED",
        actorType: "AGENT",
        channel: message.channel,
        messageId: message.id,
        data: { reason: "DUPLICATE", confidence: turn.duplicate.confidence },
      });
      return succeed({
        request: await loadView(tx, duplicateOf.id),
        created: false,
        duplicate: true,
      });
    }
    const requestId = await insertRequest(
      tx,
      turn,
      message,
      project.value,
      "NEW",
      [],
      duplicateOf?.id,
    );
    return succeed({ request: await loadView(tx, requestId), created: true, duplicate: false });
  });
}

// Files a message the agent left unhandled, for a person to look at, so that no message is lost.
// Returns undefined when the message is already filed or clearly not a request.
export function fileUnhandledMessage(
  db: Database,
  turn: ClassifiedTurn,
): Promise<RequestView | undefined> {
  return db.transaction(async (tx) => {
    const message = await lockTurnMessage(tx, turn);
    if (message.requestId !== null || isNotARequest(turn)) {
      return undefined;
    }
    const project = turn.project.status === "identified" ? turn.project.projectId : null;
    const requestId = await insertRequest(tx, turn, message, project, "NEW", ["UNHANDLED"]);
    return loadView(tx, requestId);
  });
}

async function setStatus(
  tx: Transaction,
  requestId: string,
  from: RequestStatus,
  to: RequestStatus,
  message: TurnMessage,
): Promise<void> {
  await tx.update(requests).set({ status: to }).where(eq(requests.id, requestId));
  // The status changes by a fixed rule of the system, never by a choice of the model.
  await tx.insert(events).values({
    requestId,
    type: "STATUS_CHANGED",
    actorType: "SYSTEM",
    channel: message.channel,
    messageId: message.id,
    data: { from, to },
  });
}

// Records that the agent asks the sender for details: on the request of the message, or on a new
// request filed for it. The request waits for the answer, and for a person if no answer comes.
export function requestClarification(
  db: Database,
  turn: ClassifiedTurn,
  input: RequestClarificationInput,
): Promise<Result<RequestView, "CLARIFICATION_LIMIT">> {
  return db.transaction(async (tx) => {
    const message = await lockTurnMessage(tx, turn);
    let requestId = message.requestId;
    if (requestId === null) {
      const project = turn.project.status === "identified" ? turn.project.projectId : null;
      requestId = await insertRequest(tx, turn, message, project, "WAITING_FOR_INFO");
    } else {
      const [asked] = await tx
        .select({ value: count() })
        .from(events)
        .where(and(eq(events.requestId, requestId), eq(events.type, "CLARIFICATION_REQUESTED")));
      if ((asked?.value ?? 0) >= maxClarifications) {
        await tx.update(requests).set({ needsReview: true }).where(eq(requests.id, requestId));
        return fail("CLARIFICATION_LIMIT");
      }
      const [request] = await tx
        .select({ status: requests.status })
        .from(requests)
        .where(eq(requests.id, requestId))
        .for("update");
      if (request !== undefined && request.status !== "WAITING_FOR_INFO") {
        await setStatus(tx, requestId, request.status, "WAITING_FOR_INFO", message);
      }
      await tx.update(requests).set({ needsReview: true }).where(eq(requests.id, requestId));
    }
    await tx.insert(events).values({
      requestId,
      type: "CLARIFICATION_REQUESTED",
      actorType: "AGENT",
      channel: message.channel,
      messageId: message.id,
      data: { question: input.question },
    });
    return succeed(await loadView(tx, requestId));
  });
}

// Types of a message about a request already made, rather than about a new problem.
const followUpTypes = new Set<ClassifiedTurn["classification"]["type"]>([
  "FOLLOW_UP",
  "STATUS_REQUEST",
  "OTHER",
]);

// The request a message without one belongs to, for the question it passes to the team: the
// request it names, the request of its conversation when it follows up on it, or else a new
// request filed for it. Undefined when it names a request the sender cannot reach.
async function requestForQuestion(
  tx: Transaction,
  turn: ClassifiedTurn,
  message: TurnMessage,
  reference: string | undefined,
): Promise<string | undefined> {
  let existingId: string | undefined;
  if (reference !== undefined) {
    existingId = (await lockVisibleRequest(tx, turn, reference))?.id;
    if (existingId === undefined) {
      return undefined;
    }
  } else if (followUpTypes.has(turn.classification.type)) {
    existingId = await findConversationRequestId(tx, turn);
  }
  if (existingId === undefined) {
    const project = turn.project.status === "identified" ? turn.project.projectId : null;
    return insertRequest(tx, turn, message, project, "NEW", ["QUESTION_FOR_TEAM"]);
  }
  await tx.update(messages).set({ requestId: existingId }).where(eq(messages.id, message.id));
  await tx.insert(events).values({
    requestId: existingId,
    type: "MESSAGE_ADDED",
    actorType: "AGENT",
    channel: message.channel,
    messageId: message.id,
  });
  return existingId;
}

// Passes a question or a wish of the sender that the agent cannot answer to the team: on the
// request of the message, the request it is about, the request of its conversation, or a new
// request filed for it. The request waits for a person, who sees the question in its history.
export function forwardToTeam(
  db: Database,
  turn: ClassifiedTurn,
  input: ForwardToTeamInput,
): Promise<Result<RequestView, "NOT_FOUND">> {
  return db.transaction(async (tx) => {
    const message = await lockTurnMessage(tx, turn);
    const requestId =
      message.requestId ?? (await requestForQuestion(tx, turn, message, input.reference));
    if (requestId === undefined) {
      return fail("NOT_FOUND");
    }
    await tx.update(requests).set({ needsReview: true }).where(eq(requests.id, requestId));
    await tx.insert(events).values({
      requestId,
      type: "REVIEW_REQUESTED",
      actorType: "AGENT",
      channel: message.channel,
      messageId: message.id,
      data: { reason: "QUESTION_FOR_TEAM", question: input.question },
    });
    return succeed(await loadView(tx, requestId));
  });
}

type RequestRow = typeof requests.$inferSelect;
type EditableField = "type" | "priority" | "title" | "summary" | "description";
const editableFields: EditableField[] = ["type", "priority", "title", "summary", "description"];

export function updateRequest(
  db: Database,
  turn: Turn,
  input: UpdateRequestInput,
): Promise<Result<RequestView, "NOT_FOUND" | "PROJECT_NOT_ALLOWED" | "NO_CHANGES">> {
  return db.transaction(async (tx) => {
    const request = await lockVisibleRequest(tx, turn, input.reference);
    if (request === undefined) {
      return fail("NOT_FOUND");
    }

    const values: Partial<RequestRow> = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    for (const field of editableFields) {
      const next = input.changes[field];
      if (next !== undefined && next !== request[field]) {
        Object.assign(values, { [field]: next });
        changes[field] = { from: request[field], to: next };
      }
    }
    if (input.changes.projectKey !== undefined) {
      const projectId = await findProjectId(tx, input.changes.projectKey);
      // Moving a request requires working on the target project, not only seeing the request.
      if (projectId === undefined || !worksOnProject(turn.actor, projectId)) {
        return fail("PROJECT_NOT_ALLOWED");
      }
      if (projectId !== request.projectId) {
        values.projectId = projectId;
        changes.projectKey = {
          from: (await loadView(tx, request.id)).projectKey,
          to: input.changes.projectKey.toUpperCase(),
        };
      }
    }
    if (Object.keys(changes).length === 0) {
      return fail("NO_CHANGES");
    }

    const message = await lockTurnMessage(tx, turn);
    await tx.update(requests).set(values).where(eq(requests.id, request.id));
    await tx.insert(events).values({
      requestId: request.id,
      type: "UPDATED",
      actorType: "AGENT",
      channel: message.channel,
      messageId: message.id,
      data: { changes },
    });
    return succeed(await loadView(tx, request.id));
  });
}

export function addMessageToRequest(
  db: Database,
  turn: Turn,
  input: RequestReferenceInput,
): Promise<Result<RequestView, "NOT_FOUND" | "MESSAGE_ALREADY_LINKED">> {
  return db.transaction(async (tx) => {
    const request = await lockVisibleRequest(tx, turn, input.reference);
    if (request === undefined) {
      return fail("NOT_FOUND");
    }
    const message = await lockTurnMessage(tx, turn);
    if (message.requestId === request.id) {
      return succeed(await loadView(tx, request.id));
    }
    if (message.requestId !== null) {
      return fail("MESSAGE_ALREADY_LINKED");
    }

    await tx.update(messages).set({ requestId: request.id }).where(eq(messages.id, message.id));
    // Touching the request moves it up in the lists sorted by last activity.
    await tx.update(requests).set({ updatedAt: new Date() }).where(eq(requests.id, request.id));
    // The answer of the requester to a clarification puts the request back in the queue.
    const isRequester =
      turn.actor.kind === "contact" && turn.actor.contactId === request.requesterContactId;
    if (request.status === "WAITING_FOR_INFO" && isRequester) {
      await setStatus(tx, request.id, "WAITING_FOR_INFO", "NEW", message);
    }
    // When the requester names the project of a request filed without one, such as in the answer
    // to a clarification, the request gets it, by the same rules that identify a new request's.
    const named = turn.project.status === "identified" ? turn.project.projectId : undefined;
    if (
      isRequester &&
      request.projectId === null &&
      named !== undefined &&
      assignableProjectIds(turn).includes(named)
    ) {
      await tx.update(requests).set({ projectId: named }).where(eq(requests.id, request.id));
      const projectKey = (await loadView(tx, request.id)).projectKey;
      await tx.insert(events).values({
        requestId: request.id,
        type: "UPDATED",
        actorType: "SYSTEM",
        channel: message.channel,
        messageId: message.id,
        data: { changes: { projectKey: { from: null, to: projectKey } } },
      });
    }
    await tx.insert(events).values({
      requestId: request.id,
      type: "MESSAGE_ADDED",
      actorType: "AGENT",
      channel: message.channel,
      messageId: message.id,
    });
    return succeed(await loadView(tx, request.id));
  });
}
