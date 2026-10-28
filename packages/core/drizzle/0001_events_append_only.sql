-- The history of a request must never be rewritten: events can only be added.
CREATE FUNCTION "reject_event_change"() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'events are append-only: % is not allowed', TG_OP;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER "events_append_only"
BEFORE UPDATE OR DELETE ON "events"
FOR EACH ROW EXECUTE FUNCTION "reject_event_change"();
