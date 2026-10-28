import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { alice, bruno, storeMessage } from "../../test/fixtures.ts";
import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { events, messages, requests } from "../db/schema.ts";
import { seedDatabase } from "../db/seed.ts";
import { addMessageToRequest, createRequest, updateRequest } from "./commands.ts";
import type { CreateRequestInput } from "./inputs.ts";
import { prepareTurn, type Trust } from "./turn.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

const bug: CreateRequestInput = {
  type: "BUG",
  title: "Paiement refusé",
  summary: "Les paiements par carte échouent",
  priority: "HIGH",
  confidence: 0.9,
};

async function turnFor(
  sender: string,
  options: { trust?: Trust; thread?: string; channelAddress?: string } = {},
) {
  const messageId = await storeMessage(getDatabase(), {
    sender,
    bodyText: "Les paiements échouent.",
    thread: options.thread,
  });
  return prepareTurn(getAppDatabase(), {
    messageId,
    trust: options.trust ?? "VERIFIED",
    channelAddress: options.channelAddress ?? null,
  });
}

async function waitForBlockedQueries(expected: number): Promise<void> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    // Polling is sequential by nature: each check needs the result of the previous one.
    // oxlint-disable-next-line no-await-in-loop
    const result = await getDatabase().execute<{ blocked: number }>(
      sql`select count(*)::int as blocked from pg_stat_activity
          where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if ((result.rows[0]?.blocked ?? 0) >= expected) {
      return;
    }
    // oxlint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`${expected} queries were expected to wait for a lock`);
}

async function createdReference(sender: string, input: CreateRequestInput = bug) {
  const result = await createRequest(getAppDatabase(), await turnFor(sender), input);
  if (!result.ok) {
    throw new Error(`The request was not created: ${result.error}`);
  }
  return result.value.request.reference;
}

describe("createRequest", () => {
  it("files the message as a new request, with its history", async () => {
    const turn = await turnFor(bruno);

    const result = await createRequest(getAppDatabase(), turn, { ...bug, projectKey: "portal" });

    expect(result).toMatchObject({
      ok: true,
      value: {
        created: true,
        request: { reference: "REQ-0001", projectKey: "PORTAL", needsReview: false, status: "NEW" },
      },
    });
    const [message] = await getDatabase()
      .select()
      .from(messages)
      .where(eq(messages.id, turn.messageId));
    expect(message?.requestId).not.toBeNull();
    const history = await getDatabase().select().from(events).orderBy(asc(events.type));
    expect(history.map((event) => event.type)).toEqual(["CREATED", "CLASSIFIED"]);
    expect(history.every((event) => event.messageId === turn.messageId)).toBe(true);
    expect(history.find((event) => event.type === "CLASSIFIED")?.data).toEqual({
      type: "BUG",
      priority: "HIGH",
      confidence: 0.9,
    });
  });

  it("files a message only once, even when asked twice", async () => {
    const turn = await turnFor(bruno);

    const first = await createRequest(getAppDatabase(), turn, bug);
    const second = await createRequest(getAppDatabase(), turn, { ...bug, title: "Autre titre" });

    expect(second).toMatchObject({
      ok: true,
      value: { created: false, request: { reference: "REQ-0001" } },
    });
    expect(first.ok && second.ok && second.value.request.title).toBe("Paiement refusé");
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
  });

  it("files a message only once when two attempts run at the same time", async () => {
    const turn = await turnFor(bruno);
    // Another transaction holds the message until both attempts are waiting for it, so they
    // really overlap instead of running one after the other.
    const { promise: released, resolve: release } = Promise.withResolvers<void>();
    const { promise: held, resolve: hold } = Promise.withResolvers<void>();
    const holder = getDatabase().transaction(async (tx) => {
      await tx.select().from(messages).where(eq(messages.id, turn.messageId)).for("update");
      hold();
      await released;
    });
    await held;

    const attempts = Promise.all([
      createRequest(getAppDatabase(), turn, bug),
      createRequest(getAppDatabase(), turn, bug),
    ]);
    await waitForBlockedQueries(2);
    release();
    await holder;
    const results = await attempts;

    const created = results.filter((result) => result.ok && result.value.created);
    expect(results.every((result) => result.ok)).toBe(true);
    expect(created).toHaveLength(1);
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
  });

  it("refuses a project the sender does not work on", async () => {
    const result = await createRequest(getAppDatabase(), await turnFor(bruno), {
      ...bug,
      projectKey: "SHOP",
    });

    expect(result).toEqual({ ok: false, error: "PROJECT_NOT_ALLOWED" });
    expect(await getDatabase().select().from(requests)).toHaveLength(0);
  });

  it("sends a request without a project to human review", async () => {
    const result = await createRequest(getAppDatabase(), await turnFor(alice), bug);

    expect(result).toMatchObject({
      ok: true,
      value: { request: { projectKey: null, needsReview: true } },
    });
  });

  it("sends a request from an unverified sender to human review, without a requester", async () => {
    const turn = await turnFor(alice, { trust: "UNVERIFIED" });

    const refused = await createRequest(getAppDatabase(), turn, { ...bug, projectKey: "SHOP" });
    const filed = await createRequest(getAppDatabase(), turn, bug);

    expect(refused).toEqual({ ok: false, error: "PROJECT_NOT_ALLOWED" });
    expect(filed).toMatchObject({ ok: true, value: { request: { needsReview: true } } });
    const [request] = await getDatabase().select().from(requests);
    expect(request?.requesterContactId).toBeNull();
  });

  it("lets an unverified sender use the project of a dedicated channel, with a review", async () => {
    const turn = await turnFor("someone@unknown.example", {
      trust: "UNVERIFIED",
      channelAddress: "portal-support@initech.example",
    });

    const result = await createRequest(getAppDatabase(), turn, { ...bug, projectKey: "PORTAL" });

    expect(result).toMatchObject({
      ok: true,
      value: { request: { projectKey: "PORTAL", needsReview: true } },
    });
  });
});

describe("updateRequest", () => {
  it("changes the request and records the old and new values", async () => {
    const reference = await createdReference(alice, { ...bug, projectKey: "SHOP" });

    const result = await updateRequest(getAppDatabase(), await turnFor(alice), {
      reference,
      changes: { priority: "CRITICAL", title: "Paiement refusé", projectKey: "crm" },
    });

    expect(result).toMatchObject({ ok: true, value: { priority: "CRITICAL", projectKey: "CRM" } });
    const [updated] = await getDatabase().select().from(events).where(eq(events.type, "UPDATED"));
    expect(updated?.data).toEqual({
      changes: {
        priority: { from: "HIGH", to: "CRITICAL" },
        projectKey: { from: "SHOP", to: "CRM" },
      },
    });
  });

  it("hides the requests of other organizations", async () => {
    const reference = await createdReference(alice, { ...bug, projectKey: "SHOP" });

    const result = await updateRequest(getAppDatabase(), await turnFor(bruno), {
      reference,
      changes: { priority: "LOW" },
    });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("gives an unverified sender no access, even to their own address's requests", async () => {
    const reference = await createdReference(alice, { ...bug, projectKey: "SHOP" });

    const result = await updateRequest(
      getAppDatabase(),
      await turnFor(alice, { trust: "UNVERIFIED" }),
      {
        reference,
        changes: { priority: "LOW" },
      },
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("refuses to move a request to a project the sender does not work on", async () => {
    const reference = await createdReference(alice, { ...bug, projectKey: "SHOP" });

    const result = await updateRequest(getAppDatabase(), await turnFor(alice), {
      reference,
      changes: { projectKey: "PORTAL" },
    });

    expect(result).toEqual({ ok: false, error: "PROJECT_NOT_ALLOWED" });
  });

  it("reports when nothing changes, without writing to the history", async () => {
    const reference = await createdReference(alice, { ...bug, projectKey: "SHOP" });

    const result = await updateRequest(getAppDatabase(), await turnFor(alice), {
      reference,
      changes: { priority: "HIGH", projectKey: "SHOP" },
    });

    expect(result).toEqual({ ok: false, error: "NO_CHANGES" });
    expect(
      await getDatabase().select().from(events).where(eq(events.type, "UPDATED")),
    ).toHaveLength(0);
  });
});

describe("addMessageToRequest", () => {
  it("links a follow-up message to an existing request", async () => {
    const reference = await createdReference(bruno, { ...bug, projectKey: "PORTAL" });
    const followUp = await turnFor(bruno);

    const result = await addMessageToRequest(getAppDatabase(), followUp, { reference });
    const again = await addMessageToRequest(getAppDatabase(), followUp, { reference });

    expect(result).toMatchObject({ ok: true, value: { reference } });
    expect(again.ok).toBe(true);
    const added = await getDatabase().select().from(events).where(eq(events.type, "MESSAGE_ADDED"));
    expect(added).toHaveLength(1);
    expect(added[0]?.messageId).toBe(followUp.messageId);
  });

  it("refuses a message already filed under another request", async () => {
    const first = await createdReference(bruno, { ...bug, projectKey: "PORTAL" });
    const turn = await turnFor(bruno);
    await createRequest(getAppDatabase(), turn, { ...bug, projectKey: "PORTAL" });

    const result = await addMessageToRequest(getAppDatabase(), turn, { reference: first });

    expect(result).toEqual({ ok: false, error: "MESSAGE_ALREADY_LINKED" });
  });

  it("hides the requests of other organizations", async () => {
    const reference = await createdReference(alice, { ...bug, projectKey: "SHOP" });

    const result = await addMessageToRequest(getAppDatabase(), await turnFor(bruno), { reference });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
