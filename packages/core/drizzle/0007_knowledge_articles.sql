-- Vectors of the help articles, compared by meaning (decision 010). The pgvector extension ships
-- with the database image, pgvector/pgvector.
CREATE EXTENSION IF NOT EXISTS "vector";
--> statement-breakpoint
CREATE TABLE "knowledge_articles" (
	"id" uuid PRIMARY KEY DEFAULT uuidv7() NOT NULL,
	"project_id" uuid NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"embedding_model" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_articles_project_id_source_key" UNIQUE("project_id","source")
);
--> statement-breakpoint
ALTER TABLE "knowledge_articles" ADD CONSTRAINT "knowledge_articles_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "knowledge_articles_embedding_idx" ON "knowledge_articles" USING hnsw ("embedding" vector_cosine_ops);