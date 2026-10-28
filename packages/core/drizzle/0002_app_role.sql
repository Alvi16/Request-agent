-- The application connects with this role, and migrations keep the owner role. The application can
-- read, add and update rows, but it cannot delete rows, change the schema or rewrite the history.
-- The role is created without login; `pnpm db:migrate` sets its password from APP_DATABASE_URL.
-- Roles are shared by all the databases of the server, so the role may already exist.
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'request_agent_app') THEN
    CREATE ROLE "request_agent_app" NOLOGIN;
  END IF;
END
$$;
--> statement-breakpoint
GRANT USAGE ON SCHEMA "public" TO "request_agent_app";
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA "public" TO "request_agent_app";
--> statement-breakpoint
GRANT USAGE ON ALL SEQUENCES IN SCHEMA "public" TO "request_agent_app";
--> statement-breakpoint
REVOKE UPDATE ON "events" FROM "request_agent_app";
--> statement-breakpoint
-- Tables created by later migrations get the same rights. A table with stricter rules, like events,
-- revokes them in its own migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT SELECT, INSERT, UPDATE ON TABLES TO "request_agent_app";
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA "public" GRANT USAGE ON SEQUENCES TO "request_agent_app";
