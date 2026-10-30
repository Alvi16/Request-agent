import { asc, eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { alice, bruno, classified, storeMessage } from "../../test/fixtures.ts";
import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { events, messages, requests } from "../db/schema.ts";
import { seedDatabase } from "../db/seed.ts";
import type { Classification } from "../classification/classifier.ts";
import {
  addMessageToRequest,
  createRequest,
  fileUnhandledMessage,
  forwardToTeam,
  maxClarifications,
  requestClarification,
  updateRequest,
} from "./commands.ts";
import type { CreateRequestInput } from "./inputs.ts";
import { prepareTurn, type Trust } from "./turn.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

async function turnFor(
  sender: string,
  options: {
    trust?: Trust;
    thread?: string;
    channelAddress?: string;
    classification?: Partial<Classification>;
    text?: string;
  } = {},
) {
  const messageId = await storeMessage(getDatabase(), {
    sender,
    bodyText: options.text ?? "Les paiements échouent.",
    thread: options.thread,
  });
  const turn = await prepareTurn(getAppDatabase(), {
    messageId,
    trust: options.trust ?? "VERIFIED",
    channelAddress: options.channelAddress ?? null,
  });
  return classified(turn, options.classification);
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

async function createdReference(sender: string, input: CreateRequestInput = {}) {
  // The sender names the project, as a sender working on several projects would.
  const text = input.projectKey === undefined ? undefined : `Sur ${input.projectKey}, ça échoue.`;
  const result = await createRequest(getAppDatabase(), await turnFor(sender, { text }), input);
  if (!result.ok) {
    throw new Error(`The request was not created: ${result.error}`);
  }
  return result.value.request.reference;
}

describe("createRequest", () => {
  it("files the message as a new request, with its history", async () => {
    const turn = await turnFor(bruno);

    const result = await createRequest(getAppDatabase(), turn, { projectKey: "portal" });

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
      threshold: 0.8,
      reviewReasons: [],
      model: "test-model",
      promptVersion: "test-prompt",
    });
  });

  it("files the request under the identified project and takes its content from the classification", async () => {
    const turn = await turnFor(bruno, {
      classification: { type: "SUPPORT", title: "Accès au portail", priority: null },
    });

    const result = await createRequest(getAppDatabase(), turn, {});

    expect(result).toMatchObject({
      ok: true,
      value: {
        request: {
          projectKey: "PORTAL",
          type: "SUPPORT",
          title: "Accès au portail",
          priority: null,
        },
      },
    });
    const [stored] = await getDatabase().select().from(requests);
    expect(stored?.description).toBe(turn.messageText);
  });

  it("sends a request classified with a low confidence to human review, with the reason", async () => {
    const turn = await turnFor(bruno, { classification: { confidence: 0.79 } });

    const result = await createRequest(getAppDatabase(), turn, {});

    expect(result).toMatchObject({ ok: true, value: { request: { needsReview: true } } });
    const [classifiedEvent] = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "CLASSIFIED"));
    expect(classifiedEvent?.data).toMatchObject({ reviewReasons: ["LOW_CONFIDENCE"] });
  });

  it("does not file a confident OTHER, such as thanks, as a request", async () => {
    const turn = await turnFor(bruno, { classification: { type: "OTHER", confidence: 0.95 } });

    const result = await createRequest(getAppDatabase(), turn, {});

    expect(result).toEqual({ ok: false, error: "NOT_A_REQUEST" });
    expect(await getDatabase().select().from(requests)).toHaveLength(0);
  });

  it("files an uncertain OTHER, for a person to check", async () => {
    const turn = await turnFor(bruno, { classification: { type: "OTHER", confidence: 0.5 } });

    const result = await createRequest(getAppDatabase(), turn, {});

    expect(result).toMatchObject({
      ok: true,
      value: { request: { type: "OTHER", needsReview: true } },
    });
  });

  it("files a message only once, even when asked twice", async () => {
    const turn = await turnFor(bruno);

    const first = await createRequest(getAppDatabase(), turn, {});
    const second = await createRequest(
      getAppDatabase(),
      { ...turn, classification: { ...turn.classification, title: "Autre titre" } },
      {},
    );

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
      createRequest(getAppDatabase(), turn, {}),
      createRequest(getAppDatabase(), turn, {}),
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
      projectKey: "SHOP",
    });

    expect(result).toEqual({ ok: false, error: "PROJECT_NOT_ALLOWED" });
    expect(await getDatabase().select().from(requests)).toHaveLength(0);
  });

  it("refuses to guess the project of a sender working on several projects", async () => {
    const turn = await turnFor(alice);

    expect(await createRequest(getAppDatabase(), turn, {})).toEqual({
      ok: false,
      error: "PROJECT_AMBIGUOUS",
    });
    expect(await createRequest(getAppDatabase(), turn, { projectKey: "SHOP" })).toEqual({
      ok: false,
      error: "PROJECT_AMBIGUOUS",
    });
  });

  it("sends a request from an unverified sender to human review, without a requester", async () => {
    const turn = await turnFor(alice, { trust: "UNVERIFIED" });

    const refused = await createRequest(getAppDatabase(), turn, { projectKey: "SHOP" });
    const filed = await createRequest(getAppDatabase(), turn, {});

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

    const result = await createRequest(getAppDatabase(), turn, { projectKey: "PORTAL" });

    expect(result).toMatchObject({
      ok: true,
      value: { request: { projectKey: "PORTAL", needsReview: true } },
    });
  });
});

describe("updateRequest", () => {
  it("changes the request and records the old and new values", async () => {
    const reference = await createdReference(alice, { projectKey: "SHOP" });

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
    const reference = await createdReference(alice, { projectKey: "SHOP" });

    const result = await updateRequest(getAppDatabase(), await turnFor(bruno), {
      reference,
      changes: { priority: "LOW" },
    });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });

  it("gives an unverified sender no access, even to their own address's requests", async () => {
    const reference = await createdReference(alice, { projectKey: "SHOP" });

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
    const reference = await createdReference(alice, { projectKey: "SHOP" });

    const result = await updateRequest(getAppDatabase(), await turnFor(alice), {
      reference,
      changes: { projectKey: "PORTAL" },
    });

    expect(result).toEqual({ ok: false, error: "PROJECT_NOT_ALLOWED" });
  });

  it("reports when nothing changes, without writing to the history", async () => {
    const reference = await createdReference(alice, { projectKey: "SHOP" });

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
    const reference = await createdReference(bruno, { projectKey: "PORTAL" });
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
    const first = await createdReference(bruno, { projectKey: "PORTAL" });
    const turn = await turnFor(bruno);
    await createRequest(getAppDatabase(), turn, { projectKey: "PORTAL" });

    const result = await addMessageToRequest(getAppDatabase(), turn, { reference: first });

    expect(result).toEqual({ ok: false, error: "MESSAGE_ALREADY_LINKED" });
  });

  it("hides the requests of other organizations", async () => {
    const reference = await createdReference(alice, { projectKey: "SHOP" });

    const result = await addMessageToRequest(getAppDatabase(), await turnFor(bruno), { reference });

    expect(result).toEqual({ ok: false, error: "NOT_FOUND" });
  });
});

describe("forwardToTeam", () => {
  it("passes a question to the team on the request of the message, which then waits for a person", async () => {
    const reference = await createdReference(bruno, { projectKey: "PORTAL" });
    const followUp = await turnFor(bruno, { text: "C'est pour quand ?" });
    await addMessageToRequest(getAppDatabase(), followUp, { reference });

    const result = await forwardToTeam(getAppDatabase(), followUp, {
      question: "Quand la correction est-elle prévue ?",
    });

    expect(result).toMatchObject({ ok: true, value: { reference, needsReview: true } });
    const forwarded = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "REVIEW_REQUESTED"));
    expect(forwarded).toMatchObject([
      {
        actorType: "AGENT",
        messageId: followUp.messageId,
        data: { reason: "QUESTION_FOR_TEAM", question: "Quand la correction est-elle prévue ?" },
      },
    ]);
  });

  it("passes a follow-up question to the request of its conversation, instead of a new request", async () => {
    const first = await createRequest(
      getAppDatabase(),
      await turnFor(bruno, { thread: "t-1" }),
      {},
    );
    const followUp = await turnFor(bruno, {
      thread: "t-1",
      text: "Pouvez-vous la clôturer ?",
      classification: { type: "FOLLOW_UP" },
    });

    const result = await forwardToTeam(getAppDatabase(), followUp, { question: "Clôturer ?" });

    expect(result).toMatchObject({
      ok: true,
      value: { reference: first.ok ? first.value.request.reference : "", needsReview: true },
    });
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
    const history = await getDatabase().select().from(events).orderBy(asc(events.createdAt));
    expect(
      history.filter((event) => event.messageId === followUp.messageId).map((e) => e.type),
    ).toEqual(["MESSAGE_ADDED", "REVIEW_REQUESTED"]);
  });

  it("files a new question asked in a known conversation as its own request", async () => {
    await createRequest(getAppDatabase(), await turnFor(bruno, { thread: "t-2" }), {});
    const question = await turnFor(bruno, {
      thread: "t-2",
      text: "Comment ajouter un utilisateur ?",
      classification: { type: "SUPPORT" },
    });

    await forwardToTeam(getAppDatabase(), question, { question: "Ajouter un utilisateur ?" });

    expect(await getDatabase().select().from(requests)).toHaveLength(2);
  });

  it("files a question that no request holds, even one that is not a request, for a person", async () => {
    const question = await turnFor(bruno, {
      text: "Travaillez-vous le samedi ?",
      classification: { type: "OTHER", confidence: 0.95 },
    });

    const result = await forwardToTeam(getAppDatabase(), question, {
      question: "L'équipe travaille-t-elle le samedi ?",
    });

    expect(result).toMatchObject({ ok: true, value: { type: "OTHER", needsReview: true } });
    const [classifiedEvent] = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "CLASSIFIED"));
    expect(classifiedEvent?.data).toMatchObject({ reviewReasons: ["QUESTION_FOR_TEAM"] });
    const [message] = await getDatabase()
      .select({ requestId: messages.requestId })
      .from(messages)
      .where(eq(messages.id, question.messageId));
    expect(message?.requestId).not.toBeNull();
  });
});

describe("requestClarification", () => {
  it("files the message for review and waits for the sender's answer", async () => {
    const turn = await turnFor(alice);

    const result = await requestClarification(getAppDatabase(), turn, {
      question: "Ce problème concerne-t-il la boutique (SHOP) ou le CRM ?",
    });

    expect(result).toMatchObject({
      ok: true,
      value: { status: "WAITING_FOR_INFO", needsReview: true, projectKey: null },
    });
    const [asked] = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "CLARIFICATION_REQUESTED"));
    expect(asked?.data).toEqual({
      question: "Ce problème concerne-t-il la boutique (SHOP) ou le CRM ?",
    });
  });

  it("puts the request back in the queue when its requester answers", async () => {
    const asked = await requestClarification(getAppDatabase(), await turnFor(alice), {
      question: "Quel projet ?",
    });
    const reference = asked.ok ? asked.value.reference : "";

    const answered = await addMessageToRequest(getAppDatabase(), await turnFor(alice), {
      reference,
    });

    expect(answered).toMatchObject({ ok: true, value: { status: "NEW" } });
    const changes = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "STATUS_CHANGED"));
    expect(changes.map((event) => [event.actorType, event.data])).toEqual([
      ["SYSTEM", { from: "WAITING_FOR_INFO", to: "NEW" }],
    ]);
  });

  it("files the request under the project the requester names in the answer", async () => {
    const asked = await requestClarification(getAppDatabase(), await turnFor(alice), {
      question: "Quel projet ?",
    });
    const reference = asked.ok ? asked.value.reference : "";
    const answer = await turnFor(alice, { text: "C'est sur la boutique, le projet SHOP." });

    const result = await addMessageToRequest(getAppDatabase(), answer, { reference });

    expect(result).toMatchObject({ ok: true, value: { projectKey: "SHOP", status: "NEW" } });
    const [updated] = await getDatabase().select().from(events).where(eq(events.type, "UPDATED"));
    expect([updated?.actorType, updated?.data]).toEqual([
      "SYSTEM",
      { changes: { projectKey: { from: null, to: "SHOP" } } },
    ]);
  });

  it("leaves the project empty when the answer does not name one", async () => {
    const asked = await requestClarification(getAppDatabase(), await turnFor(alice), {
      question: "Quel projet ?",
    });
    const reference = asked.ok ? asked.value.reference : "";

    const result = await addMessageToRequest(getAppDatabase(), await turnFor(alice), { reference });

    expect(result).toMatchObject({ ok: true, value: { projectKey: null } });
  });

  it("keeps waiting when someone other than the requester adds a message", async () => {
    // Alice names the project, so Chloé, who also works on it, can reach the request.
    const turn = await turnFor(alice, { thread: "t", text: "Sur le SHOP, un détail manque." });
    const asked = await requestClarification(getAppDatabase(), turn, { question: "Quel détail ?" });
    const reference = asked.ok ? asked.value.reference : "";
    const chloe = await turnFor("chloe.durand@initech.example", { thread: "t" });

    const result = await addMessageToRequest(getAppDatabase(), chloe, { reference });

    expect(result).toMatchObject({
      ok: true,
      value: { projectKey: "SHOP", status: "WAITING_FOR_INFO" },
    });
  });

  it("asks at most a fixed number of times, then leaves the request to a person", async () => {
    const first = await turnFor(alice, { thread: "loop" });
    await requestClarification(getAppDatabase(), first, { question: "Quel projet ?" });
    const reference = (await getDatabase().select().from(requests))[0]?.number ?? 0;
    for (let attempt = 1; attempt < maxClarifications; attempt += 1) {
      // Each answer is a new message of the same conversation, handled one after the other.
      // oxlint-disable-next-line no-await-in-loop
      const answer = await turnFor(alice, { thread: "loop" });
      // oxlint-disable-next-line no-await-in-loop
      await addMessageToRequest(getAppDatabase(), answer, { reference: `REQ-${reference}` });
      // oxlint-disable-next-line no-await-in-loop
      await requestClarification(getAppDatabase(), answer, { question: "Lequel exactement ?" });
    }
    const last = await turnFor(alice, { thread: "loop" });
    await addMessageToRequest(getAppDatabase(), last, { reference: `REQ-${reference}` });

    const result = await requestClarification(getAppDatabase(), last, { question: "Encore ?" });

    expect(result).toEqual({ ok: false, error: "CLARIFICATION_LIMIT" });
    const asked = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "CLARIFICATION_REQUESTED"));
    expect(asked).toHaveLength(maxClarifications);
  });
});

describe("fileUnhandledMessage", () => {
  it("files a message the agent left unhandled, for a person to look at", async () => {
    const turn = await turnFor(alice);

    const request = await fileUnhandledMessage(getAppDatabase(), turn);

    expect(request).toMatchObject({ projectKey: null, needsReview: true, status: "NEW" });
    const [classifiedEvent] = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "CLASSIFIED"));
    expect(classifiedEvent?.data).toMatchObject({
      reviewReasons: ["PROJECT_AMBIGUOUS", "UNHANDLED"],
    });
  });

  it("does nothing when the agent filed the message, or when it is clearly not a request", async () => {
    const filed = await turnFor(bruno);
    await createRequest(getAppDatabase(), filed, {});
    const thanks = await turnFor(bruno, { classification: { type: "OTHER", confidence: 0.95 } });

    expect(await fileUnhandledMessage(getAppDatabase(), filed)).toBeUndefined();
    expect(await fileUnhandledMessage(getAppDatabase(), thanks)).toBeUndefined();
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
  });
});
