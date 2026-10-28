CREATE TYPE "public"."actor_type" AS ENUM('AGENT', 'HUMAN', 'SYSTEM');--> statement-breakpoint
CREATE TYPE "public"."channel" AS ENUM('SLACK', 'EMAIL');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('CREATED', 'CLASSIFIED', 'UPDATED', 'STATUS_CHANGED', 'MESSAGE_ADDED', 'CLARIFICATION_REQUESTED', 'REVIEW_REQUESTED', 'REVIEWED', 'MARKED_DUPLICATE');--> statement-breakpoint
CREATE TYPE "public"."message_direction" AS ENUM('INBOUND', 'OUTBOUND');--> statement-breakpoint
CREATE TYPE "public"."request_priority" AS ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');--> statement-breakpoint
CREATE TYPE "public"."request_status" AS ENUM('NEW', 'IN_PROGRESS', 'WAITING_FOR_INFO', 'RESOLVED', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."request_type" AS ENUM('BUG', 'FEATURE_REQUEST', 'CHANGE_REQUEST', 'EVOLUTION', 'SUPPORT', 'FOLLOW_UP', 'STATUS_REQUEST', 'OTHER');--> statement-breakpoint
CREATE TABLE "attachments" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"message_id" uuid NOT NULL,
	"filename" text NOT NULL,
	"content_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"storage_ref" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attachments_size_positive" CHECK ("attachments"."size_bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "contacts" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"organization_id" uuid,
	"name" text,
	"email" text,
	"slack_user_id" text,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "contacts_email_unique" UNIQUE("email"),
	CONSTRAINT "contacts_slack_user_id_unique" UNIQUE("slack_user_id"),
	CONSTRAINT "contacts_email_lowercase" CHECK ("contacts"."email" = lower("contacts"."email")),
	CONSTRAINT "contacts_has_identity" CHECK ("contacts"."email" is not null or "contacts"."slack_user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"subject" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_channel_external_id_key" UNIQUE("channel","external_id"),
	CONSTRAINT "conversations_id_channel_key" UNIQUE("id","channel")
);
--> statement-breakpoint
CREATE TABLE "events" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"request_id" uuid NOT NULL,
	"type" "event_type" NOT NULL,
	"actor_type" "actor_type" NOT NULL,
	"actor_contact_id" uuid,
	"channel" "channel",
	"message_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"direction" "message_direction" NOT NULL,
	"request_id" uuid,
	"author_contact_id" uuid,
	"sender" text NOT NULL,
	"subject" text,
	"body_text" text NOT NULL,
	"raw" jsonb NOT NULL,
	"in_reply_to" text,
	"sent_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_channel_external_id_key" UNIQUE("channel","external_id")
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"name" text NOT NULL,
	"email_domain" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_email_domain_unique" UNIQUE("email_domain"),
	CONSTRAINT "organizations_email_domain_lowercase" CHECK ("organizations"."email_domain" = lower("organizations"."email_domain"))
);
--> statement-breakpoint
CREATE TABLE "project_channels" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"channel" "channel" NOT NULL,
	"external_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_channels_channel_external_id_key" UNIQUE("channel","external_id")
);
--> statement-breakpoint
CREATE TABLE "project_contacts" (
	"project_id" uuid NOT NULL,
	"contact_id" uuid NOT NULL,
	"role" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "project_contacts_project_id_contact_id_pk" PRIMARY KEY("project_id","contact_id")
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_key_unique" UNIQUE("key"),
	CONSTRAINT "projects_key_format" CHECK ("projects"."key" ~ '^[A-Z][A-Z0-9]{1,9}$')
);
--> statement-breakpoint
CREATE TABLE "requests" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"number" integer GENERATED ALWAYS AS IDENTITY (sequence name "requests_number_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"project_id" uuid,
	"requester_contact_id" uuid,
	"type" "request_type" NOT NULL,
	"status" "request_status" DEFAULT 'NEW' NOT NULL,
	"priority" "request_priority",
	"title" text NOT NULL,
	"summary" text,
	"description" text,
	"source_channel" "channel" NOT NULL,
	"confidence" real,
	"needs_review" boolean DEFAULT false NOT NULL,
	"duplicate_of_request_id" uuid,
	"search" "tsvector" GENERATED ALWAYS AS (setweight(to_tsvector('french', "requests"."title"), 'A') || setweight(to_tsvector('french', coalesce("requests"."summary", '')), 'B') || setweight(to_tsvector('french', coalesce("requests"."description", '')), 'C')) STORED NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "requests_number_unique" UNIQUE("number"),
	CONSTRAINT "requests_confidence_range" CHECK ("requests"."confidence" between 0 and 1),
	CONSTRAINT "requests_not_duplicate_of_itself" CHECK ("requests"."duplicate_of_request_id" <> "requests"."id")
);
--> statement-breakpoint
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_actor_contact_id_contacts_id_fk" FOREIGN KEY ("actor_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_request_id_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_author_contact_id_contacts_id_fk" FOREIGN KEY ("author_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_fkey" FOREIGN KEY ("conversation_id","channel") REFERENCES "public"."conversations"("id","channel") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_channels" ADD CONSTRAINT "project_channels_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_contacts" ADD CONSTRAINT "project_contacts_contact_id_contacts_id_fk" FOREIGN KEY ("contact_id") REFERENCES "public"."contacts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_requester_contact_id_contacts_id_fk" FOREIGN KEY ("requester_contact_id") REFERENCES "public"."contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "requests" ADD CONSTRAINT "requests_duplicate_of_request_id_fkey" FOREIGN KEY ("duplicate_of_request_id") REFERENCES "public"."requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attachments_message_id_idx" ON "attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "contacts_organization_id_idx" ON "contacts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "events_request_id_created_at_idx" ON "events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "messages_conversation_id_idx" ON "messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "messages_request_id_idx" ON "messages" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "messages_author_contact_id_idx" ON "messages" USING btree ("author_contact_id");--> statement-breakpoint
CREATE INDEX "project_channels_project_id_idx" ON "project_channels" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "project_contacts_contact_id_idx" ON "project_contacts" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "requests_project_id_idx" ON "requests" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "requests_requester_contact_id_idx" ON "requests" USING btree ("requester_contact_id");--> statement-breakpoint
CREATE INDEX "requests_status_idx" ON "requests" USING btree ("status");--> statement-breakpoint
CREATE INDEX "requests_needs_review_idx" ON "requests" USING btree ("needs_review") WHERE "requests"."needs_review";--> statement-breakpoint
CREATE INDEX "requests_search_idx" ON "requests" USING gin ("search");