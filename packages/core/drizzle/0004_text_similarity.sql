-- Trigram similarity and accent removal, used to find requests about the same problem worded
-- differently. Both extensions ship with PostgreSQL.
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS "unaccent";
