import { eq, type SQL } from "drizzle-orm";

import type { Database, Transaction } from "../db/client.ts";
import { projects, requests } from "../db/schema.ts";
import { formatReference } from "./reference.ts";

// What callers see of a request. It leaves out internal IDs and the full description, which may
// hold text written by other people: the agent gets what it needs to answer, nothing more.
export interface RequestView {
  reference: string;
  type: (typeof requests.$inferSelect)["type"];
  status: (typeof requests.$inferSelect)["status"];
  priority: (typeof requests.$inferSelect)["priority"];
  title: string;
  summary: string | null;
  projectKey: string | null;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export type Result<T, E extends string> = { ok: true; value: T } | { ok: false; error: E };

export function succeed<T>(value: T): { ok: true; value: T } {
  return { ok: true, value };
}

export function fail<E extends string>(error: E): { ok: false; error: E } {
  return { ok: false, error };
}

const requestViewColumns = {
  id: requests.id,
  number: requests.number,
  type: requests.type,
  status: requests.status,
  priority: requests.priority,
  title: requests.title,
  summary: requests.summary,
  projectKey: projects.key,
  needsReview: requests.needsReview,
  createdAt: requests.createdAt,
  updatedAt: requests.updatedAt,
};

type RequestViewRow = Awaited<ReturnType<typeof selectRequestViews>>[number];

export function toRequestView(row: RequestViewRow): RequestView {
  return {
    reference: formatReference(row.number),
    type: row.type,
    status: row.status,
    priority: row.priority,
    title: row.title,
    summary: row.summary,
    projectKey: row.projectKey,
    needsReview: row.needsReview,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Requests matching a condition, with their project key, as rows ready for toRequestView.
export function selectRequestViews(db: Database | Transaction, where: SQL) {
  return db
    .select(requestViewColumns)
    .from(requests)
    .leftJoin(projects, eq(projects.id, requests.projectId))
    .where(where);
}
