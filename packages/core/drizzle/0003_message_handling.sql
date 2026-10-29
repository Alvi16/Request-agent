ALTER TABLE "messages" ADD COLUMN "handled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "handling_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "messages_unhandled_idx" ON "messages" USING btree ("received_at") WHERE "messages"."direction" = 'INBOUND' and "messages"."handled_at" is null;--> statement-breakpoint
-- Messages stored before this migration were handled by the version that received them.
UPDATE "messages" SET "handled_at" = "received_at" WHERE "direction" = 'INBOUND';
