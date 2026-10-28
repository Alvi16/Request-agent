import { eq, inArray, or, type SQL, sql } from "drizzle-orm";

import { requests } from "../db/schema.ts";
import type { Actor } from "./turn.ts";

// The single access rule, applied to every read and write: a contact reaches the requests of the
// projects they work on, and the requests they made. Anyone else reaches none.
export function visibleRequests(actor: Actor): SQL {
  if (actor.kind === "anonymous") {
    return sql`false`;
  }
  const own = eq(requests.requesterContactId, actor.contactId);
  if (actor.projectIds.length === 0) {
    return own;
  }
  return or(own, inArray(requests.projectId, actor.projectIds)) ?? own;
}

export function worksOnProject(actor: Actor, projectId: string): boolean {
  return actor.kind === "contact" && actor.projectIds.includes(projectId);
}
