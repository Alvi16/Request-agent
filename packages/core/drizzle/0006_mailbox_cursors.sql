CREATE TABLE "mailbox_cursors" (
	"mailbox" text PRIMARY KEY NOT NULL,
	"uid_validity" bigint NOT NULL,
	"last_uid" bigint NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
