import { and, count, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import type { Database } from "../db/client.ts";
import { contacts, events, messages, organizations, projects, requests } from "../db/schema.ts";
import { visibleRequests, worksOnProject } from "./access.ts";
import type {
  FindRequestInput,
  ListProjectRequestsInput,
  RequestReferenceInput,
  SearchRequestsInput,
} from "./inputs.ts";
import { parseReference } from "./reference.ts";
import type { Turn } from "./turn.ts";
import {
  fail,
  type RequestView,
  type Result,
  selectRequestViews,
  succeed,
  toRequestView,
} from "./views.ts";

// How many history entries a request lookup returns: enough to answer "where is it?".
const recentEventCount = 5;

interface ProjectSummary {
  key: string;
  name: string;
}

export type ContactDescription =
  | {
      status: "known";
      name: string | null;
      role: string | null;
      organization: string | null;
      projects: ProjectSummary[];
    }
  | { status: "unverified" };

export type ProjectDescription =
  | { status: "identified"; project: ProjectSummary; source: "CHANNEL" | "MENTION" | "CONTACT" }
  | { status: "ambiguous"; candidates: ProjectSummary[] }
  | { status: "unknown" };

export interface RequestDetails {
  request: RequestView;
  messageCount: number;
  recentEvents: { type: (typeof events.$inferSelect)["type"]; at: string }[];
}

export interface RequestStatus {
  reference: string;
  status: RequestView["status"];
  priority: RequestView["priority"];
  needsReview: boolean;
  updatedAt: string;
  lastEvent: { type: (typeof events.$inferSelect)["type"]; at: string } | null;
}

async function projectSummaries(db: Database, ids: string[]): Promise<ProjectSummary[]> {
  if (ids.length === 0) {
    return [];
  }
  return db
    .select({ key: projects.key, name: projects.name })
    .from(projects)
    .where(inArray(projects.id, ids))
    .orderBy(projects.key);
}

export async function describeContact(db: Database, turn: Turn): Promise<ContactDescription> {
  if (turn.actor.kind === "anonymous") {
    return { status: "unverified" };
  }
  const [contact] = await db
    .select({ name: contacts.name, role: contacts.role, organization: organizations.name })
    .from(contacts)
    .leftJoin(organizations, eq(organizations.id, contacts.organizationId))
    .where(eq(contacts.id, turn.actor.contactId));
  if (contact === undefined) {
    throw new Error(`Contact ${turn.actor.contactId} of the turn does not exist`);
  }
  return {
    status: "known",
    ...contact,
    projects: await projectSummaries(db, turn.actor.projectIds),
  };
}

export async function describeProject(db: Database, turn: Turn): Promise<ProjectDescription> {
  const identification = turn.project;
  if (identification.status === "unknown") {
    return identification;
  }
  if (identification.status === "ambiguous") {
    return {
      status: "ambiguous",
      candidates: await projectSummaries(db, identification.candidateIds),
    };
  }
  const [project] = await projectSummaries(db, [identification.projectId]);
  if (project === undefined) {
    throw new Error(`Project ${identification.projectId} of the turn does not exist`);
  }
  return { status: "identified", project, source: identification.source };
}

// The request most recently linked to the conversation of the message being handled: a reply in a
// thread usually follows up on it.
async function findConversationRequestId(db: Database, turn: Turn): Promise<string | undefined> {
  const conversation = db
    .select({ id: messages.conversationId })
    .from(messages)
    .where(eq(messages.id, turn.messageId));
  const [row] = await db
    .select({ id: requests.id })
    .from(messages)
    .innerJoin(requests, eq(requests.id, messages.requestId))
    .where(
      and(
        inArray(messages.conversationId, conversation),
        isNotNull(messages.requestId),
        visibleRequests(turn.actor),
      ),
    )
    .orderBy(desc(messages.sentAt))
    .limit(1);
  return row?.id;
}

async function findVisibleRequestId(
  db: Database,
  turn: Turn,
  reference: string,
): Promise<string | undefined> {
  const requestNumber = parseReference(reference);
  if (requestNumber === undefined) {
    return undefined;
  }
  const [row] = await db
    .select({ id: requests.id })
    .from(requests)
    .where(and(eq(requests.number, requestNumber), visibleRequests(turn.actor)));
  return row?.id;
}

async function recentEvents(db: Database, requestId: string, limit: number) {
  const rows = await db
    .select({ type: events.type, at: events.createdAt })
    .from(events)
    .where(eq(events.requestId, requestId))
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(limit);
  return rows.map((row) => ({ type: row.type, at: row.at.toISOString() }));
}

export async function findRequest(
  db: Database,
  turn: Turn,
  input: FindRequestInput,
): Promise<Result<RequestDetails, "NOT_FOUND">> {
  const requestId =
    input.reference === undefined
      ? await findConversationRequestId(db, turn)
      : await findVisibleRequestId(db, turn, input.reference);
  if (requestId === undefined) {
    return fail("NOT_FOUND");
  }
  const [row] = await selectRequestViews(db, eq(requests.id, requestId));
  if (row === undefined) {
    return fail("NOT_FOUND");
  }
  const [messageCount] = await db
    .select({ value: count() })
    .from(messages)
    .where(eq(messages.requestId, requestId));
  return succeed({
    request: toRequestView(row),
    messageCount: messageCount?.value ?? 0,
    recentEvents: await recentEvents(db, requestId, recentEventCount),
  });
}

export async function getRequestStatus(
  db: Database,
  turn: Turn,
  input: RequestReferenceInput,
): Promise<Result<RequestStatus, "NOT_FOUND">> {
  const requestId = await findVisibleRequestId(db, turn, input.reference);
  if (requestId === undefined) {
    return fail("NOT_FOUND");
  }
  const [row] = await selectRequestViews(db, eq(requests.id, requestId));
  if (row === undefined) {
    return fail("NOT_FOUND");
  }
  const view = toRequestView(row);
  const [lastEvent] = await recentEvents(db, requestId, 1);
  return succeed({
    reference: view.reference,
    status: view.status,
    priority: view.priority,
    needsReview: view.needsReview,
    updatedAt: view.updatedAt,
    lastEvent: lastEvent ?? null,
  });
}

// Resolves a project key to a project the actor works on. Other projects look like unknown ones.
async function findWorkedOnProjectId(
  db: Database,
  turn: Turn,
  key: string,
): Promise<string | undefined> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.key, key.toUpperCase()));
  return project !== undefined && worksOnProject(turn.actor, project.id) ? project.id : undefined;
}

export async function listProjectRequests(
  db: Database,
  turn: Turn,
  input: ListProjectRequestsInput,
): Promise<Result<RequestView[], "PROJECT_NOT_FOUND">> {
  const projectId = await findWorkedOnProjectId(db, turn, input.projectKey);
  if (projectId === undefined) {
    return fail("PROJECT_NOT_FOUND");
  }
  const rows = await selectRequestViews(
    db,
    and(
      eq(requests.projectId, projectId),
      input.status === undefined ? undefined : eq(requests.status, input.status),
    ) ?? eq(requests.projectId, projectId),
  )
    .orderBy(desc(requests.updatedAt), desc(requests.number))
    .limit(input.limit);
  return succeed(rows.map(toRequestView));
}

// Full-text search in French over the title, summary and description, best matches first.
export async function searchRequests(
  db: Database,
  turn: Turn,
  input: SearchRequestsInput,
): Promise<Result<RequestView[], "PROJECT_NOT_FOUND">> {
  let projectId: string | undefined;
  if (input.projectKey !== undefined) {
    projectId = await findWorkedOnProjectId(db, turn, input.projectKey);
    if (projectId === undefined) {
      return fail("PROJECT_NOT_FOUND");
    }
  }
  const query = sql`websearch_to_tsquery('french', ${input.query})`;
  const matches = sql`${requests.search} @@ ${query}`;
  const rows = await selectRequestViews(
    db,
    and(
      matches,
      visibleRequests(turn.actor),
      projectId === undefined ? undefined : eq(requests.projectId, projectId),
    ) ?? matches,
  )
    .orderBy(desc(sql`ts_rank(${requests.search}, ${query})`), desc(requests.updatedAt))
    .limit(input.limit);
  return succeed(rows.map(toRequestView));
}
