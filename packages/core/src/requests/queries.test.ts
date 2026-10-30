import { beforeEach, describe, expect, it } from "vitest";

import { alice, bruno, chloeSlackId, classified, storeMessage } from "../../test/fixtures.ts";
import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { seedDatabase } from "../db/seed.ts";
import {
  addMessageToRequest,
  createRequest,
  fileUnhandledMessage,
  updateRequest,
} from "./commands.ts";
import type { Classification } from "../classification/classifier.ts";
import {
  findRequest,
  getRequestStatus,
  listContactRequests,
  listProjectRequests,
  searchRequests,
} from "./queries.ts";
import { prepareTurn, type Trust } from "./turn.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

async function turnFor(
  sender: string,
  options: { channel?: "SLACK" | "EMAIL"; trust?: Trust; thread?: string; text?: string } = {},
) {
  const messageId = await storeMessage(getDatabase(), {
    channel: options.channel,
    sender,
    bodyText: options.text ?? "Message",
    thread: options.thread,
  });
  return prepareTurn(getAppDatabase(), {
    messageId,
    trust: options.trust ?? "VERIFIED",
    channelAddress: null,
  });
}

// Files a request whose message was classified with the given values.
async function file(
  sender: string,
  input: Pick<Classification, "type" | "title"> & { summary?: string; projectKey?: string },
  thread?: string,
): Promise<string> {
  const { projectKey, summary = "", ...classification } = input;
  // The message says what the title says, since the description keeps the message text.
  // The sender names the project, as a sender working on several projects would.
  const text =
    projectKey === undefined ? classification.title : `${classification.title} (${projectKey})`;
  const turn = classified(
    await turnFor(sender, { thread, text }),
    { ...classification, summary },
    classification.title,
  );
  const result = await createRequest(getAppDatabase(), turn, { projectKey });
  if (!result.ok) {
    throw new Error(`The request was not created: ${result.error}`);
  }
  return result.value.request.reference;
}

// A request without a project, as filed for review when the project of a sender is unclear.
async function fileWithoutProject(sender: string, title: string, thread?: string): Promise<string> {
  const turn = classified(await turnFor(sender, { thread, text: title }), { title }, title);
  const request = await fileUnhandledMessage(getAppDatabase(), turn);
  if (request === undefined) {
    throw new Error("The request was not filed");
  }
  return request.reference;
}

const chloe = (options: { thread?: string } = {}) =>
  turnFor(chloeSlackId, { channel: "SLACK", ...options });

describe("findRequest", () => {
  it("returns a request with its history, without the text of its messages", async () => {
    const reference = await file(alice, { type: "BUG", title: "Panier vidé", projectKey: "SHOP" });
    await addMessageToRequest(getAppDatabase(), await turnFor(alice), { reference });

    const result = await findRequest(getAppDatabase(), await turnFor(alice), { reference });

    expect(result).toMatchObject({ ok: true, value: { request: { reference }, messageCount: 2 } });
    expect(result.ok && result.value.recentEvents.map((event) => event.type)).toEqual([
      "MESSAGE_ADDED",
      "CLASSIFIED",
      "CREATED",
    ]);
    expect(JSON.stringify(result)).not.toContain("Message");
  });

  it("finds the request of the current conversation when no reference is given", async () => {
    const reference = await file(bruno, { type: "BUG", title: "Portail lent" }, "thread-portal");

    const result = await findRequest(
      getAppDatabase(),
      await turnFor(bruno, { thread: "thread-portal" }),
      {},
    );

    expect(result).toMatchObject({ ok: true, value: { request: { reference } } });
  });

  it("does not reveal the request of a conversation that the sender cannot reach", async () => {
    // Alice's request has no project, so only Alice reaches it, even in a shared thread.
    await fileWithoutProject(alice, "Accès perdu", "thread-shared");

    const result = await findRequest(
      getAppDatabase(),
      await turnFor(bruno, { thread: "thread-shared" }),
      {},
    );

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("hides requests the sender cannot reach, as if they did not exist", async () => {
    const reference = await file(alice, { type: "BUG", title: "Panier vidé", projectKey: "SHOP" });

    expect(await findRequest(getAppDatabase(), await turnFor(bruno), { reference })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(
      await findRequest(getAppDatabase(), await turnFor(alice, { trust: "UNVERIFIED" }), {
        reference,
      }),
    ).toEqual({ ok: false, error: "NOT_FOUND" });
    expect(
      await findRequest(getAppDatabase(), await turnFor(alice), { reference: "REQ-9999" }),
    ).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  it("lets a contact reach the requests they made, even outside their projects", async () => {
    // Without a project, the request belongs to no project the contact works on.
    const reference = await fileWithoutProject(alice, "Accès perdu");

    expect((await findRequest(getAppDatabase(), await turnFor(alice), { reference })).ok).toBe(
      true,
    );
    expect((await findRequest(getAppDatabase(), await chloe(), { reference })).ok).toBe(false);
  });
});

describe("getRequestStatus", () => {
  it("returns the status with the last event", async () => {
    const reference = await file(alice, { type: "BUG", title: "Panier vidé", projectKey: "SHOP" });
    await updateRequest(getAppDatabase(), await turnFor(alice), {
      reference,
      changes: { priority: "CRITICAL" },
    });

    const result = await getRequestStatus(getAppDatabase(), await chloe(), { reference });

    expect(result).toMatchObject({
      ok: true,
      value: { reference, status: "NEW", priority: "CRITICAL", lastEvent: { type: "UPDATED" } },
    });
  });
});

describe("listProjectRequests", () => {
  it("lists the requests of a project, most recent activity first, with a status filter", async () => {
    const first = await file(alice, { type: "BUG", title: "Panier vidé", projectKey: "SHOP" });
    const second = await file(alice, {
      type: "FEATURE_REQUEST",
      title: "Paiement en 3 fois",
      projectKey: "SHOP",
    });
    await file(alice, { type: "BUG", title: "Export cassé", projectKey: "CRM" });

    const all = await listProjectRequests(getAppDatabase(), await chloe(), {
      projectKey: "shop",
      limit: 10,
    });
    const done = await listProjectRequests(getAppDatabase(), await chloe(), {
      projectKey: "SHOP",
      status: "RESOLVED",
      limit: 10,
    });

    expect(all.ok && all.value.map((request) => request.reference)).toEqual([second, first]);
    expect(done).toEqual({ ok: true, value: [] });
  });

  it("treats a project the sender does not work on as unknown", async () => {
    await file(bruno, { type: "BUG", title: "Portail lent", projectKey: "PORTAL" });

    expect(
      await listProjectRequests(getAppDatabase(), await turnFor(alice), {
        projectKey: "PORTAL",
        limit: 10,
      }),
    ).toEqual({ ok: false, error: "PROJECT_NOT_FOUND" });
  });
});

describe("listContactRequests", () => {
  it("lists the requests the sender made or wrote in, most recent activity first", async () => {
    const portal = await file(bruno, { type: "BUG", title: "Portail lent", projectKey: "PORTAL" });
    await file(alice, { type: "BUG", title: "Panier vidé", projectKey: "SHOP" });
    await addMessageToRequest(getAppDatabase(), await chloe(), { reference: portal });
    const later = await file(bruno, { type: "BUG", title: "Export vide", projectKey: "PORTAL" });

    const ofBruno = await listContactRequests(getAppDatabase(), await turnFor(bruno), {
      limit: 10,
    });
    const ofChloe = await listContactRequests(getAppDatabase(), await chloe(), { limit: 10 });

    expect(ofBruno.ok && ofBruno.value.map((request) => request.reference)).toEqual([
      later,
      portal,
    ]);
    expect(ofChloe.ok && ofChloe.value.map((request) => request.reference)).toEqual([portal]);
  });

  it("gives an unverified sender nothing", async () => {
    await file(bruno, { type: "BUG", title: "Portail lent", projectKey: "PORTAL" });

    expect(
      await listContactRequests(getAppDatabase(), await turnFor(bruno, { trust: "UNVERIFIED" }), {
        limit: 10,
      }),
    ).toEqual({ ok: false, error: "UNVERIFIED_SENDER" });
  });
});

describe("searchRequests", () => {
  it("finds requests by meaning in French, best matches first", async () => {
    const title = await file(alice, { type: "BUG", title: "Paiement refusé", projectKey: "SHOP" });
    const summary = await file(alice, {
      type: "BUG",
      title: "Erreur au panier",
      summary: "Le paiement ne passe pas",
      projectKey: "SHOP",
    });
    await file(alice, { type: "BUG", title: "Export cassé", projectKey: "CRM" });

    const result = await searchRequests(getAppDatabase(), await turnFor(alice), {
      query: "paiements",
      limit: 10,
    });

    expect(result.ok && result.value.map((request) => request.reference)).toEqual([title, summary]);
  });

  it("only searches the requests the sender can reach", async () => {
    await file(alice, { type: "BUG", title: "Paiement refusé", projectKey: "SHOP" });
    const own = await file(bruno, {
      type: "BUG",
      title: "Paiement du portail",
      projectKey: "PORTAL",
    });

    const result = await searchRequests(getAppDatabase(), await turnFor(bruno), {
      query: "paiement",
      limit: 10,
    });
    const anonymous = await searchRequests(
      getAppDatabase(),
      await turnFor(bruno, { trust: "UNVERIFIED" }),
      { query: "paiement", limit: 10 },
    );

    expect(result.ok && result.value.map((request) => request.reference)).toEqual([own]);
    expect(anonymous).toEqual({ ok: true, value: [] });
  });

  it("can be limited to one project", async () => {
    await file(alice, { type: "BUG", title: "Paiement refusé", projectKey: "SHOP" });
    const crm = await file(alice, {
      type: "BUG",
      title: "Paiement des factures",
      projectKey: "CRM",
    });

    const result = await searchRequests(getAppDatabase(), await chloe(), {
      query: "paiement",
      projectKey: "CRM",
      limit: 10,
    });

    expect(result.ok && result.value.map((request) => request.reference)).toEqual([crm]);
  });

  it("treats search operators in the query as plain text", async () => {
    await file(alice, { type: "BUG", title: "Paiement refusé", projectKey: "SHOP" });

    const result = await searchRequests(getAppDatabase(), await turnFor(alice), {
      query: "paiement' OR 1=1 --",
      limit: 10,
    });

    expect(result.ok).toBe(true);
  });
});
