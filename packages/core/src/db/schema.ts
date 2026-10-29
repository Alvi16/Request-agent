import { type SQL, sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

// Every table uses UUIDv7 identifiers: unique and ordered by creation time, which keeps indexes compact.
const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`uuidv7()`);
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

export const channel = pgEnum("channel", ["SLACK", "EMAIL"]);
export const messageDirection = pgEnum("message_direction", ["INBOUND", "OUTBOUND"]);
export const requestType = pgEnum("request_type", [
  "BUG",
  "FEATURE_REQUEST",
  "CHANGE_REQUEST",
  "EVOLUTION",
  "SUPPORT",
  "FOLLOW_UP",
  "STATUS_REQUEST",
  "OTHER",
]);
export const requestStatus = pgEnum("request_status", [
  "NEW",
  "IN_PROGRESS",
  "WAITING_FOR_INFO",
  "RESOLVED",
  "CLOSED",
]);
export const requestPriority = pgEnum("request_priority", ["LOW", "MEDIUM", "HIGH", "CRITICAL"]);
export const eventType = pgEnum("event_type", [
  "CREATED",
  "CLASSIFIED",
  "UPDATED",
  "STATUS_CHANGED",
  "MESSAGE_ADDED",
  "CLARIFICATION_REQUESTED",
  "REVIEW_REQUESTED",
  "REVIEWED",
  "MARKED_DUPLICATE",
]);
export const actorType = pgEnum("actor_type", ["AGENT", "HUMAN", "SYSTEM"]);

export const organizations = pgTable(
  "organizations",
  {
    id: id(),
    name: text("name").notNull(),
    // Domain of the organization's email addresses, used to recognize a sender's organization.
    emailDomain: text("email_domain").unique(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("organizations_email_domain_lowercase", sql`${t.emailDomain} = lower(${t.emailDomain})`),
  ],
);

export const contacts = pgTable(
  "contacts",
  {
    id: id(),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    name: text("name"),
    email: text("email").unique(),
    slackUserId: text("slack_user_id").unique(),
    role: text("role"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("contacts_email_lowercase", sql`${t.email} = lower(${t.email})`),
    check("contacts_has_identity", sql`${t.email} is not null or ${t.slackUserId} is not null`),
    index("contacts_organization_id_idx").on(t.organizationId),
  ],
);

export const projects = pgTable(
  "projects",
  {
    id: id(),
    // Short code used by people to name the project, such as SHOP.
    key: text("key").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [check("projects_key_format", sql`${t.key} ~ '^[A-Z][A-Z0-9]{1,9}$'`)],
);

// Who works on which project. A contact linked to several projects makes the project ambiguous.
export const projectContacts = pgTable(
  "project_contacts",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    contactId: uuid("contact_id")
      .notNull()
      .references(() => contacts.id, { onDelete: "cascade" }),
    role: text("role"),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.projectId, t.contactId] }),
    index("project_contacts_contact_id_idx").on(t.contactId),
  ],
);

// A Slack channel or an email address dedicated to one project identifies it without the model.
export const projectChannels = pgTable(
  "project_channels",
  {
    id: id(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    channel: channel("channel").notNull(),
    // Slack channel ID or email address.
    externalId: text("external_id").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique("project_channels_channel_external_id_key").on(t.channel, t.externalId),
    index("project_channels_project_id_idx").on(t.projectId),
  ],
);

export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    channel: channel("channel").notNull(),
    // Slack thread (channel ID and thread timestamp) or Message-ID of the first email.
    externalId: text("external_id").notNull(),
    subject: text("subject"),
    createdAt: createdAt(),
  },
  (t) => [
    unique("conversations_channel_external_id_key").on(t.channel, t.externalId),
    // Target of the messages foreign key that keeps a message on the channel of its conversation.
    unique("conversations_id_channel_key").on(t.id, t.channel),
  ],
);

export const requests = pgTable(
  "requests",
  {
    id: id(),
    // Sequential number shown to people as a reference, such as REQ-0042.
    number: integer("number").notNull().unique().generatedAlwaysAsIdentity(),
    projectId: uuid("project_id").references(() => projects.id),
    requesterContactId: uuid("requester_contact_id").references(() => contacts.id),
    type: requestType("type").notNull(),
    status: requestStatus("status").notNull().default("NEW"),
    priority: requestPriority("priority"),
    title: text("title").notNull(),
    summary: text("summary"),
    description: text("description"),
    sourceChannel: channel("source_channel").notNull(),
    // Confidence of the agent in its classification, from 0 to 1. Empty when a person created the request.
    confidence: real("confidence"),
    needsReview: boolean("needs_review").notNull().default(false),
    duplicateOfRequestId: uuid("duplicate_of_request_id"),
    search: tsvector("search")
      .notNull()
      .generatedAlwaysAs(
        (): SQL =>
          sql`setweight(to_tsvector('french', ${requests.title}), 'A') || setweight(to_tsvector('french', coalesce(${requests.summary}, '')), 'B') || setweight(to_tsvector('french', coalesce(${requests.description}, '')), 'C')`,
      ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    foreignKey({
      name: "requests_duplicate_of_request_id_fkey",
      columns: [t.duplicateOfRequestId],
      foreignColumns: [t.id],
    }),
    check("requests_confidence_range", sql`${t.confidence} between 0 and 1`),
    check("requests_not_duplicate_of_itself", sql`${t.duplicateOfRequestId} <> ${t.id}`),
    index("requests_project_id_idx").on(t.projectId),
    index("requests_requester_contact_id_idx").on(t.requesterContactId),
    index("requests_status_idx").on(t.status),
    index("requests_needs_review_idx")
      .on(t.needsReview)
      .where(sql`${t.needsReview}`),
    index("requests_search_idx").using("gin", t.search),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id").notNull(),
    channel: channel("channel").notNull(),
    // Slack message (channel ID and timestamp) or email Message-ID. Unique, so a message is stored once.
    externalId: text("external_id").notNull(),
    direction: messageDirection("direction").notNull(),
    requestId: uuid("request_id").references(() => requests.id),
    authorContactId: uuid("author_contact_id").references(() => contacts.id),
    // Sender as given by the channel: email address or Slack user ID.
    sender: text("sender").notNull(),
    subject: text("subject"),
    bodyText: text("body_text").notNull(),
    // Original payload received from the channel, kept to always be able to go back to the source.
    raw: jsonb("raw").notNull(),
    inReplyTo: text("in_reply_to"),
    sentAt: timestamp("sent_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
    // When the system finished with an inbound message, whatever the outcome. A message still
    // empty after a restart was never handled, and is handled again.
    handledAt: timestamp("handled_at", { withTimezone: true }),
    // Failed attempts to handle the message, so a message that keeps failing is not retried forever.
    handlingAttempts: integer("handling_attempts").notNull().default(0),
  },
  (t) => [
    unique("messages_channel_external_id_key").on(t.channel, t.externalId),
    foreignKey({
      name: "messages_conversation_fkey",
      columns: [t.conversationId, t.channel],
      foreignColumns: [conversations.id, conversations.channel],
    }),
    index("messages_conversation_id_idx").on(t.conversationId),
    index("messages_request_id_idx").on(t.requestId),
    index("messages_author_contact_id_idx").on(t.authorContactId),
    // Finds the inbound messages left unhandled, which are few, without reading all messages.
    index("messages_unhandled_idx")
      .on(t.receivedAt)
      .where(sql`${t.direction} = 'INBOUND' and ${t.handledAt} is null`),
  ],
);

export const attachments = pgTable(
  "attachments",
  {
    id: id(),
    messageId: uuid("message_id")
      .notNull()
      .references(() => messages.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    contentType: text("content_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    // Location of the stored file. Empty when only the metadata is kept.
    storageRef: text("storage_ref"),
    createdAt: createdAt(),
  },
  (t) => [
    check("attachments_size_positive", sql`${t.sizeBytes} >= 0`),
    index("attachments_message_id_idx").on(t.messageId),
  ],
);

// History of each request. Rows are only ever added: a database trigger rejects updates and deletes.
export const events = pgTable(
  "events",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => requests.id),
    type: eventType("type").notNull(),
    actorType: actorType("actor_type").notNull(),
    actorContactId: uuid("actor_contact_id").references(() => contacts.id),
    channel: channel("channel"),
    messageId: uuid("message_id").references(() => messages.id),
    // Details of the event: changed values, classification, confidence, reason.
    data: jsonb("data").notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("events_request_id_created_at_idx").on(t.requestId, t.createdAt)],
);
