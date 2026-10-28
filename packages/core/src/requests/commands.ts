import { and, eq } from "drizzle-orm";

import type { Database, Transaction } from "../db/client.ts";
import { events, messages, projects, requests } from "../db/schema.ts";
import { visibleRequests, worksOnProject } from "./access.ts";
import type { CreateRequestInput, RequestReferenceInput, UpdateRequestInput } from "./inputs.ts";
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

export interface CreatedRequest {
  request: RequestView;
  // False when the message had already been filed: the existing request is returned instead.
  created: boolean;
}

export function createRequest(
  db: Database,
  turn: Turn,
  input: CreateRequestInput,
): Promise<Result<CreatedRequest, "PROJECT_NOT_ALLOWED">> {
  return db.transaction(async (tx) => {
    const message = await lockTurnMessage(tx, turn);
    if (message.requestId !== null) {
      return succeed({ request: await loadView(tx, message.requestId), created: false });
    }

    let projectId: string | null = null;
    if (input.projectKey !== undefined) {
      const found = await findProjectId(tx, input.projectKey);
      if (found === undefined || !assignableProjectIds(turn).includes(found)) {
        return fail("PROJECT_NOT_ALLOWED");
      }
      projectId = found;
    }

    // A request from an unverified sender, or without a project, always waits for a person.
    const needsReview = turn.actor.kind === "anonymous" || projectId === null;
    const [request] = await tx
      .insert(requests)
      .values({
        projectId,
        requesterContactId: turn.actor.kind === "contact" ? turn.actor.contactId : null,
        type: input.type,
        priority: input.priority ?? null,
        title: input.title,
        summary: input.summary ?? null,
        description: input.description ?? null,
        sourceChannel: message.channel,
        confidence: input.confidence,
        needsReview,
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
      {
        ...origin,
        type: "CREATED",
        data: { title: input.title, projectKey: input.projectKey ?? null },
      },
      {
        ...origin,
        type: "CLASSIFIED",
        data: { type: input.type, priority: input.priority ?? null, confidence: input.confidence },
      },
    ]);
    return succeed({ request: await loadView(tx, request.id), created: true });
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
