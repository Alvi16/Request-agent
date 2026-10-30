import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { alice, bruno, classified, storeMessage } from "../../test/fixtures.ts";
import { contacts, events, requests } from "../db/schema.ts";
import { seedDatabase } from "../db/seed.ts";
import { unclassifiedTurn } from "./classified-turn.ts";
import {
  addMessageToRequest,
  createRequest,
  fileUnhandledMessage,
  forwardToTeam,
} from "./commands.ts";
import { listReviewQueue, markDuplicate, type Reviewer, reviewRequest } from "./review.ts";
import { prepareTurn } from "./turn.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

let reviewer: Reviewer;

beforeEach(async () => {
  await seedDatabase(getDatabase());
  const [chloe] = await getDatabase()
    .select({ id: contacts.id })
    .from(contacts)
    .where(eq(contacts.email, "chloe.durand@initech.example"));
  reviewer = { contactId: chloe?.id ?? null };
});

async function turnFor(sender: string, text: string) {
  const messageId = await storeMessage(getDatabase(), { sender, bodyText: text });
  return prepareTurn(getAppDatabase(), { messageId, trust: "VERIFIED", channelAddress: null });
}

// A request waiting for review: Alice works on two projects and did not say which one.
async function reviewedLater(): Promise<string> {
  const request = await fileUnhandledMessage(
    getAppDatabase(),
    classified(await turnFor(alice, "Le bouton ne marche plus.")),
  );
  if (request === undefined) {
    throw new Error("The request was not filed");
  }
  return request.reference;
}

describe("listReviewQueue", () => {
  it("lists the requests waiting for a person, oldest first, with their reasons", async () => {
    const first = await reviewedLater();
    const second = await reviewedLater();
    await createRequest(
      getAppDatabase(),
      classified(await turnFor(bruno, "Le portail plante.")),
      {},
    );

    const queue = await listReviewQueue(getAppDatabase());

    expect(queue.map((item) => item.request.reference)).toEqual([first, second]);
    expect(queue[0]?.reasons).toEqual(["PROJECT_AMBIGUOUS", "UNHANDLED"]);
  });

  it("adds a question passed to the team since the last review to the reasons", async () => {
    const created = await createRequest(
      getAppDatabase(),
      classified(await turnFor(bruno, "Le portail plante.")),
      {},
    );
    const reference = created.ok ? created.value.request.reference : "";
    const followUp = classified(await turnFor(bruno, "C'est pour quand ?"));
    await addMessageToRequest(getAppDatabase(), followUp, { reference });
    await forwardToTeam(getAppDatabase(), followUp, { question: "Quand est-ce prévu ?" });

    const [waiting] = await listReviewQueue(getAppDatabase());
    await reviewRequest(getAppDatabase(), reviewer, { reference, changes: {} });

    expect(waiting).toMatchObject({ request: { reference }, reasons: ["QUESTION_FOR_TEAM"] });
    expect(await listReviewQueue(getAppDatabase())).toEqual([]);
  });
});

describe("reviewRequest", () => {
  it("takes the request out of the queue with the corrections, recorded as a person's action", async () => {
    const reference = await reviewedLater();

    const result = await reviewRequest(getAppDatabase(), reviewer, {
      reference,
      changes: { projectKey: "shop", priority: "CRITICAL", status: "IN_PROGRESS" },
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        needsReview: false,
        projectKey: "SHOP",
        priority: "CRITICAL",
        status: "IN_PROGRESS",
      },
    });
    expect(await listReviewQueue(getAppDatabase())).toEqual([]);
    const history = await getDatabase().select().from(events).where(eq(events.actorType, "HUMAN"));
    expect(history.map((event) => [event.type, event.actorContactId])).toEqual([
      ["STATUS_CHANGED", reviewer.contactId],
      ["REVIEWED", reviewer.contactId],
    ]);
    expect(history[1]?.data).toMatchObject({
      changes: {
        priority: { from: "HIGH", to: "CRITICAL" },
        projectKey: { from: null, to: "shop" },
      },
    });
  });

  it("refuses an unknown request or project", async () => {
    const reference = await reviewedLater();

    expect(
      await reviewRequest(getAppDatabase(), reviewer, { reference: "REQ-9999", changes: {} }),
    ).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
    expect(
      await reviewRequest(getAppDatabase(), reviewer, {
        reference,
        changes: { projectKey: "NOPE" },
      }),
    ).toEqual({ ok: false, error: "PROJECT_NOT_FOUND" });
  });
});

describe("markDuplicate", () => {
  it("closes the request and points it to the original", async () => {
    const original = await reviewedLater();
    const repeated = await reviewedLater();

    const result = await markDuplicate(getAppDatabase(), reviewer, {
      reference: repeated,
      duplicateOf: original,
    });

    expect(result).toMatchObject({ ok: true, value: { status: "CLOSED", needsReview: false } });
    const [first, second] = await getDatabase().select().from(requests).orderBy(requests.number);
    expect(second?.duplicateOfRequestId).toBe(first?.id);
    const [marked] = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "MARKED_DUPLICATE"));
    expect(marked?.data).toEqual({ duplicateOf: original });
  });

  it("refuses a request marked as its own duplicate", async () => {
    const reference = await reviewedLater();

    expect(
      await markDuplicate(getAppDatabase(), reviewer, { reference, duplicateOf: reference }),
    ).toEqual({
      ok: false,
      error: "SAME_REQUEST",
    });
  });
});

describe("unclassified messages", () => {
  it("files a message the model could not classify, for a person, as OTHER with no confidence", async () => {
    const turn = await turnFor(bruno, "Le portail plante.");

    const request = await fileUnhandledMessage(
      getAppDatabase(),
      await unclassifiedTurn(getAppDatabase(), turn),
    );

    expect(request).toMatchObject({
      type: "OTHER",
      needsReview: true,
      projectKey: "PORTAL",
      title: "Le portail plante.",
    });
    const [item] = await listReviewQueue(getAppDatabase());
    expect(item?.reasons).toEqual(["LOW_CONFIDENCE", "UNHANDLED"]);
  });
});
