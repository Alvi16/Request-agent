import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "../db/client.ts";
import { events, projects, requests } from "../db/schema.ts";
import { parseReference } from "./reference.ts";
import {
  fail,
  type RequestView,
  type Result,
  selectRequestViews,
  succeed,
  toRequestView,
} from "./views.ts";

// The person who reviews, as recorded in the history. These operations are for the team, not for
// senders: the caller, such as the web interface, decides who may use them.
export interface Reviewer {
  contactId: string | null;
}

type RequestRow = typeof requests.$inferSelect;

const reference = z.string().regex(/^REQ-\d{1,9}$/i);

export const reviewRequestInput = z.object({
  reference,
  changes: z
    .object({
      type: z.enum(requests.type.enumValues).optional(),
      priority: z.enum(requests.priority.enumValues).nullable().optional(),
      projectKey: z
        .string()
        .regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/)
        .nullable()
        .optional(),
      status: z.enum(requests.status.enumValues).optional(),
    })
    .default({}),
});

export const markDuplicateInput = z.object({ reference, duplicateOf: reference });

export type ReviewRequestInput = z.infer<typeof reviewRequestInput>;
export type MarkDuplicateInput = z.infer<typeof markDuplicateInput>;

export interface ReviewItem {
  request: RequestView;
  // Why the request waits for a person, as recorded when it was classified.
  reasons: string[];
}

async function lockRequest(tx: Transaction, value: string): Promise<RequestRow | undefined> {
  const requestNumber = parseReference(value);
  if (requestNumber === undefined) {
    return undefined;
  }
  const [row] = await tx
    .select()
    .from(requests)
    .where(eq(requests.number, requestNumber))
    .for("update");
  return row;
}

async function view(tx: Database | Transaction, requestId: string): Promise<RequestView> {
  const [row] = await selectRequestViews(tx, eq(requests.id, requestId));
  if (row === undefined) {
    throw new Error(`Request ${requestId} disappeared`);
  }
  return toRequestView(row);
}

// Requests waiting for a person, oldest first, with the reasons of the review.
export async function listReviewQueue(db: Database, limit = 50): Promise<ReviewItem[]> {
  const rows = await selectRequestViews(db, eq(requests.needsReview, true))
    .orderBy(asc(requests.createdAt))
    .limit(limit);
  return Promise.all(
    rows.map(async (row) => ({
      request: toRequestView(row),
      reasons: await reviewReasonsOf(db, row.id),
    })),
  );
}

// Why the request was sent to a person: the reasons recorded by its latest classification, and a
// question the agent passed to the team since the last review.
export async function reviewReasonsOf(db: Database, requestId: string): Promise<string[]> {
  const [classified] = await db
    .select({ data: events.data })
    .from(events)
    .where(and(eq(events.requestId, requestId), eq(events.type, "CLASSIFIED")))
    .orderBy(desc(events.createdAt))
    .limit(1);
  const reasons = z
    .object({ reviewReasons: z.array(z.string()).default([]) })
    .catch({ reviewReasons: [] })
    .parse(classified?.data ?? {}).reviewReasons;
  const [latest] = await db
    .select({ type: events.type })
    .from(events)
    .where(
      and(eq(events.requestId, requestId), inArray(events.type, ["REVIEW_REQUESTED", "REVIEWED"])),
    )
    .orderBy(desc(events.createdAt), desc(events.id))
    .limit(1);
  const forwarded = latest?.type === "REVIEW_REQUESTED";
  return forwarded && !reasons.includes("QUESTION_FOR_TEAM")
    ? [...reasons, "QUESTION_FOR_TEAM"]
    : reasons;
}

// A person checked the request: it leaves the queue, with the corrections they made, recorded in
// its history.
export function reviewRequest(
  db: Database,
  reviewer: Reviewer,
  input: ReviewRequestInput,
): Promise<Result<RequestView, "NOT_FOUND" | "PROJECT_NOT_FOUND">> {
  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.reference);
    if (request === undefined) {
      return fail("NOT_FOUND");
    }
    const values: Partial<RequestRow> = { needsReview: false };
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const { type, priority, projectKey, status } = input.changes;
    if (type !== undefined && type !== request.type) {
      values.type = type;
      changes.type = { from: request.type, to: type };
    }
    if (priority !== undefined && priority !== request.priority) {
      values.priority = priority;
      changes.priority = { from: request.priority, to: priority };
    }
    if (projectKey !== undefined) {
      const [project] =
        projectKey === null
          ? [{ id: null }]
          : await tx
              .select({ id: projects.id })
              .from(projects)
              .where(eq(projects.key, projectKey.toUpperCase()));
      if (project === undefined) {
        return fail("PROJECT_NOT_FOUND");
      }
      if (project.id !== request.projectId) {
        values.projectId = project.id;
        changes.projectKey = { from: (await view(tx, request.id)).projectKey, to: projectKey };
      }
    }
    if (status !== undefined && status !== request.status) {
      values.status = status;
    }
    await tx.update(requests).set(values).where(eq(requests.id, request.id));
    const actor = {
      requestId: request.id,
      actorType: "HUMAN" as const,
      actorContactId: reviewer.contactId,
    };
    if (values.status !== undefined) {
      await tx.insert(events).values({
        ...actor,
        type: "STATUS_CHANGED",
        data: { from: request.status, to: values.status },
      });
    }
    await tx.insert(events).values({ ...actor, type: "REVIEWED", data: { changes } });
    return succeed(await view(tx, request.id));
  });
}

// A person found that the request repeats another one: it is closed and points to the original.
export function markDuplicate(
  db: Database,
  reviewer: Reviewer,
  input: MarkDuplicateInput,
): Promise<Result<RequestView, "NOT_FOUND" | "SAME_REQUEST">> {
  return db.transaction(async (tx) => {
    const request = await lockRequest(tx, input.reference);
    const original = await lockRequest(tx, input.duplicateOf);
    if (request === undefined || original === undefined) {
      return fail("NOT_FOUND");
    }
    if (request.id === original.id) {
      return fail("SAME_REQUEST");
    }
    await tx
      .update(requests)
      .set({ duplicateOfRequestId: original.id, status: "CLOSED", needsReview: false })
      .where(eq(requests.id, request.id));
    const actor = {
      requestId: request.id,
      actorType: "HUMAN" as const,
      actorContactId: reviewer.contactId,
    };
    await tx.insert(events).values([
      {
        ...actor,
        type: "MARKED_DUPLICATE",
        data: { duplicateOf: (await view(tx, original.id)).reference },
      },
      { ...actor, type: "STATUS_CHANGED", data: { from: request.status, to: "CLOSED" } },
    ]);
    return succeed(await view(tx, request.id));
  });
}
