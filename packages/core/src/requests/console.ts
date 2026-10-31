import { and, asc, count, desc, eq, inArray, or, type SQL, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { z } from "zod";

import type { Database } from "../db/client.ts";
import {
  attachments,
  channel,
  contacts,
  events,
  messages,
  organizations,
  projects,
  requestStatus,
  requestType,
  requests,
} from "../db/schema.ts";
import { formatReference, parseReference } from "./reference.ts";
import { reviewReasonsOf, type Reviewer } from "./review.ts";
import { fail, type Result, succeed } from "./views.ts";

// Read operations of the web interface. They are for the team, who see every request: unlike the
// agent tools, they apply no access rule, and the caller must have checked who the person is.

export const consolePageSize = 50;

// Empty fields of a form or a query string mean "no filter".
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());

export const listRequestsInput = z.object({
  query: optional(z.string().trim().max(200)),
  projectKey: optional(z.string().regex(/^[A-Za-z][A-Za-z0-9]{1,9}$/)),
  status: optional(z.enum(requestStatus.enumValues)),
  type: optional(z.enum(requestType.enumValues)),
  channel: optional(z.enum(channel.enumValues)),
  needsReview: optional(z.enum(["true"]).transform(() => true)),
  page: optional(z.coerce.number().int().min(1).max(10_000)).transform((page) => page ?? 1),
});

export type ListRequestsInput = z.input<typeof listRequestsInput>;

export const changeStatusInput = z.object({
  reference: z.string().regex(/^REQ-\d{1,9}$/i),
  status: z.enum(requestStatus.enumValues),
});

export type ChangeStatusInput = z.infer<typeof changeStatusInput>;

type RequestRow = typeof requests.$inferSelect;

export interface ConsoleRequest {
  reference: string;
  title: string;
  type: RequestRow["type"];
  status: RequestRow["status"];
  priority: RequestRow["priority"];
  projectKey: string | null;
  requester: string | null;
  sourceChannel: RequestRow["sourceChannel"];
  confidence: number | null;
  needsReview: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface RequestRecord extends ConsoleRequest {
  summary: string | null;
  description: string | null;
  projectName: string | null;
  requesterContact: {
    name: string | null;
    email: string | null;
    organization: string | null;
  } | null;
  reviewReasons: string[];
  duplicateOf: string | null;
  duplicates: string[];
  messages: {
    direction: (typeof messages.$inferSelect)["direction"];
    channel: RequestRow["sourceChannel"];
    sender: string;
    authorName: string | null;
    subject: string | null;
    bodyText: string;
    sentAt: string;
    // Stored is false when the channel only described the file, such as an email attachment.
    attachments: {
      id: string;
      filename: string;
      contentType: string;
      sizeBytes: number;
      stored: boolean;
    }[];
  }[];
  history: {
    type: (typeof events.$inferSelect)["type"];
    actorType: (typeof events.$inferSelect)["actorType"];
    actorName: string | null;
    channel: RequestRow["sourceChannel"] | null;
    data: unknown;
    at: string;
  }[];
}

const consoleColumns = {
  id: requests.id,
  number: requests.number,
  title: requests.title,
  type: requests.type,
  status: requests.status,
  priority: requests.priority,
  projectKey: projects.key,
  requesterName: contacts.name,
  requesterEmail: contacts.email,
  sourceChannel: requests.sourceChannel,
  confidence: requests.confidence,
  needsReview: requests.needsReview,
  createdAt: requests.createdAt,
  updatedAt: requests.updatedAt,
};

function selectConsoleRequests(db: Database, where: SQL | undefined) {
  return db
    .select(consoleColumns)
    .from(requests)
    .leftJoin(projects, eq(projects.id, requests.projectId))
    .leftJoin(contacts, eq(contacts.id, requests.requesterContactId))
    .where(where);
}

type ConsoleRow = Awaited<ReturnType<typeof selectConsoleRequests>>[number];

function toConsoleRequest(row: ConsoleRow): ConsoleRequest {
  return {
    reference: formatReference(row.number),
    title: row.title,
    type: row.type,
    status: row.status,
    priority: row.priority,
    projectKey: row.projectKey,
    requester: row.requesterName ?? row.requesterEmail,
    sourceChannel: row.sourceChannel,
    confidence: row.confidence,
    needsReview: row.needsReview,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// Most words a search looks for: enough for a search box, and it bounds the size of the query.
const maxSearchWords = 10;

// The text a search looks into: what the list shows of a request and the words behind it, in lower
// case and without accents.
const searchedText = sql`unaccent(lower(concat_ws(' ',
  'REQ-' || lpad(${requests.number}::text, greatest(4, length(${requests.number}::text)), '0'),
  ${requests.title}, ${requests.summary}, ${requests.description}, ${contacts.name}, ${contacts.email})))`;

// As in the search box of a website: each word typed must appear somewhere, even as the start or
// a part of a word, whatever its accents and case. LIKE wildcards typed are taken literally.
function containsEveryWord(text: string): SQL | undefined {
  const words = text
    .split(/\s+/)
    .filter((word) => word !== "")
    .slice(0, maxSearchWords);
  return and(
    ...words.map((word) => {
      const literal = word.replaceAll(/[\\%_]/g, "\\$&");
      return sql`${searchedText} like '%' || unaccent(lower(${literal})) || '%'`;
    }),
  );
}

// Requests matching the filters, a page at a time. A search finds parts of words of the reference,
// title, summary, description and requester, or French words in other forms, such as "factures"
// for "facture". Requests whose words match best come first, then the titles closest to the search.
export async function listRequests(
  db: Database,
  input: z.output<typeof listRequestsInput>,
): Promise<{ items: ConsoleRequest[]; total: number }> {
  const search = input.query;
  const fullText =
    search === undefined ? undefined : sql`websearch_to_tsquery('french', ${search})`;
  const referenceNumber = search === undefined ? undefined : parseReference(search);
  const where = and(
    search === undefined
      ? undefined
      : or(
          sql`${requests.search} @@ ${fullText}`,
          containsEveryWord(search),
          referenceNumber === undefined ? undefined : eq(requests.number, referenceNumber),
        ),
    input.projectKey === undefined ? undefined : eq(projects.key, input.projectKey.toUpperCase()),
    input.status === undefined ? undefined : eq(requests.status, input.status),
    input.type === undefined ? undefined : eq(requests.type, input.type),
    input.channel === undefined ? undefined : eq(requests.sourceChannel, input.channel),
    input.needsReview === undefined ? undefined : eq(requests.needsReview, true),
  );
  const order =
    search === undefined
      ? [desc(requests.updatedAt), desc(requests.number)]
      : [
          desc(sql`ts_rank(${requests.search}, ${fullText})`),
          desc(
            sql`word_similarity(unaccent(lower(${search})), unaccent(lower(${requests.title})))`,
          ),
          desc(requests.updatedAt),
          desc(requests.number),
        ];
  const [rows, [total]] = await Promise.all([
    selectConsoleRequests(db, where)
      .orderBy(...order)
      .limit(consolePageSize)
      .offset((input.page - 1) * consolePageSize),
    db
      .select({ value: count() })
      .from(requests)
      .leftJoin(projects, eq(projects.id, requests.projectId))
      .leftJoin(contacts, eq(contacts.id, requests.requesterContactId))
      .where(where),
  ]);
  return { items: rows.map(toConsoleRequest), total: total?.value ?? 0 };
}

// The messages of the request, with the answers the agent sent to them: an answer is stored in
// the conversation and names the message it answers.
async function requestMessages(db: Database, requestId: string) {
  const answered = alias(messages, "answered");
  const answers = db
    .select({ id: messages.id })
    .from(messages)
    .innerJoin(
      answered,
      and(
        eq(answered.conversationId, messages.conversationId),
        eq(answered.externalId, messages.inReplyTo),
      ),
    )
    .where(and(eq(messages.direction, "OUTBOUND"), eq(answered.requestId, requestId)));
  const rows = await db
    .select({
      id: messages.id,
      direction: messages.direction,
      channel: messages.channel,
      sender: messages.sender,
      authorName: contacts.name,
      subject: messages.subject,
      bodyText: messages.bodyText,
      sentAt: messages.sentAt,
    })
    .from(messages)
    .leftJoin(contacts, eq(contacts.id, messages.authorContactId))
    .where(or(eq(messages.requestId, requestId), inArray(messages.id, answers)))
    .orderBy(asc(messages.sentAt), asc(messages.id));
  const files =
    rows.length === 0
      ? []
      : await db
          .select({
            messageId: attachments.messageId,
            id: attachments.id,
            filename: attachments.filename,
            contentType: attachments.contentType,
            sizeBytes: attachments.sizeBytes,
            storageRef: attachments.storageRef,
          })
          .from(attachments)
          .where(
            inArray(
              attachments.messageId,
              rows.map((row) => row.id),
            ),
          )
          .orderBy(asc(attachments.createdAt));
  return rows.map((row) => ({
    direction: row.direction,
    channel: row.channel,
    sender: row.sender,
    authorName: row.authorName,
    subject: row.subject,
    bodyText: row.bodyText,
    sentAt: row.sentAt.toISOString(),
    attachments: files
      .filter((file) => file.messageId === row.id)
      .map(({ id, filename, contentType, sizeBytes, storageRef }) => ({
        id,
        filename,
        contentType,
        sizeBytes,
        stored: storageRef !== null,
      })),
  }));
}

async function requestHistory(db: Database, requestId: string) {
  const rows = await db
    .select({
      type: events.type,
      actorType: events.actorType,
      actorName: contacts.name,
      actorEmail: contacts.email,
      channel: events.channel,
      data: events.data,
      at: events.createdAt,
    })
    .from(events)
    .leftJoin(contacts, eq(contacts.id, events.actorContactId))
    .where(eq(events.requestId, requestId))
    .orderBy(asc(events.createdAt), asc(events.id));
  return rows.map((row) => ({
    type: row.type,
    actorType: row.actorType,
    actorName: row.actorName ?? row.actorEmail,
    channel: row.channel,
    data: row.data,
    at: row.at.toISOString(),
  }));
}

// Everything about one request: its fields, who asked, why it waits for a review, its messages and
// its full history.
export async function getRequestRecord(
  db: Database,
  reference: string,
): Promise<RequestRecord | undefined> {
  const requestNumber = parseReference(reference);
  if (requestNumber === undefined) {
    return undefined;
  }
  const original = alias(requests, "original");
  const [row] = await db
    .select({
      ...consoleColumns,
      summary: requests.summary,
      description: requests.description,
      projectName: projects.name,
      organization: organizations.name,
      duplicateOfNumber: original.number,
    })
    .from(requests)
    .leftJoin(projects, eq(projects.id, requests.projectId))
    .leftJoin(contacts, eq(contacts.id, requests.requesterContactId))
    .leftJoin(organizations, eq(organizations.id, contacts.organizationId))
    .leftJoin(original, eq(original.id, requests.duplicateOfRequestId))
    .where(eq(requests.number, requestNumber));
  if (row === undefined) {
    return undefined;
  }
  const [reviewReasons, duplicates, requestMessageList, history] = await Promise.all([
    reviewReasonsOf(db, row.id),
    db
      .select({ number: requests.number })
      .from(requests)
      .where(eq(requests.duplicateOfRequestId, row.id))
      .orderBy(asc(requests.number)),
    requestMessages(db, row.id),
    requestHistory(db, row.id),
  ]);
  return {
    ...toConsoleRequest(row),
    summary: row.summary,
    description: row.description,
    projectName: row.projectName,
    requesterContact:
      row.requesterName === null && row.requesterEmail === null
        ? null
        : { name: row.requesterName, email: row.requesterEmail, organization: row.organization },
    reviewReasons,
    duplicateOf: row.duplicateOfNumber === null ? null : formatReference(row.duplicateOfNumber),
    duplicates: duplicates.map((duplicate) => formatReference(duplicate.number)),
    messages: requestMessageList,
    history,
  };
}

// Every project, for the filters and the review form.
export function listProjects(db: Database): Promise<{ key: string; name: string }[]> {
  return db.select({ key: projects.key, name: projects.name }).from(projects).orderBy(projects.key);
}

// A person moves the request forward, for instance from NEW to IN_PROGRESS, recorded in its
// history.
export function changeRequestStatus(
  db: Database,
  reviewer: Reviewer,
  input: ChangeStatusInput,
): Promise<Result<RequestRow["status"], "NOT_FOUND">> {
  return db.transaction(async (tx) => {
    const requestNumber = parseReference(input.reference);
    const [request] =
      requestNumber === undefined
        ? []
        : await tx
            .select({ id: requests.id, status: requests.status })
            .from(requests)
            .where(eq(requests.number, requestNumber))
            .for("update");
    if (request === undefined) {
      return fail("NOT_FOUND");
    }
    if (request.status !== input.status) {
      await tx.update(requests).set({ status: input.status }).where(eq(requests.id, request.id));
      await tx.insert(events).values({
        requestId: request.id,
        type: "STATUS_CHANGED",
        actorType: "HUMAN",
        actorContactId: reviewer.contactId,
        data: { from: request.status, to: input.status },
      });
    }
    return succeed(input.status);
  });
}

// A stored file attached to a message, for the team to download. Undefined when the file was not
// kept, such as an email attachment of which only the description is stored.
export async function getStoredAttachment(
  db: Database,
  id: string,
): Promise<{ filename: string; contentType: string; storageRef: string } | undefined> {
  const [file] = await db
    .select({
      filename: attachments.filename,
      contentType: attachments.contentType,
      storageRef: attachments.storageRef,
    })
    .from(attachments)
    .where(eq(attachments.id, id));
  if (file === undefined || file.storageRef === null) {
    return undefined;
  }
  return { filename: file.filename, contentType: file.contentType, storageRef: file.storageRef };
}
