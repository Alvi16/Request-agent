import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { alice, bruno, classified, storeMessage } from "../../test/fixtures.ts";
import type { Classification } from "../classification/classifier.ts";
import { events, messages, requests } from "../db/schema.ts";
import { seedDatabase } from "../db/seed.ts";
import { createRequest } from "./commands.ts";
import { assessDuplicate, findDuplicateCandidates } from "./duplicates.ts";
import { prepareTurn, type Trust } from "./turn.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

async function turnFor(
  sender: string,
  text: string,
  classification: Partial<Classification> = {},
  trust: Trust = "VERIFIED",
) {
  const messageId = await storeMessage(getDatabase(), { sender, bodyText: text });
  const turn = await prepareTurn(getAppDatabase(), { messageId, trust, channelAddress: null });
  return classified(turn, classification, text);
}

async function file(sender: string, title: string, summary: string): Promise<string> {
  const turn = await turnFor(sender, `${title} sur le SHOP`, { title, summary });
  const result = await createRequest(getAppDatabase(), turn, { projectKey: "SHOP" });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value.request.reference;
}

describe("findDuplicateCandidates", () => {
  it("proposes the open requests of the project about the same words, most similar first", async () => {
    const cart = await file(alice, "Panier vidé après ajout d'un produit", "Le panier se vide.");
    await file(alice, "Photos floues sur mobile", "Les photos des produits sont floues.");

    const turn = await turnFor(alice, "Sur le SHOP, quand j'ajoute un article le panier se vide.", {
      title: "Le panier se vide",
      summary: "Le panier se vide à l'ajout d'un article.",
    });
    const candidates = await findDuplicateCandidates(getAppDatabase(), turn);

    expect(candidates[0]).toMatchObject({
      reference: cart,
      title: "Panier vidé après ajout d'un produit",
    });
  });

  it("leaves out closed requests and the request of the message itself", async () => {
    const closed = await file(alice, "Panier vidé", "Le panier se vide.");
    await getDatabase().update(requests).set({ status: "CLOSED" }).where(eq(requests.number, 1));

    const turn = await turnFor(alice, "Sur le SHOP, le panier se vide.", { title: "Panier vidé" });
    const own = await createRequest(getAppDatabase(), turn, { projectKey: "SHOP" });

    const candidates = await findDuplicateCandidates(getAppDatabase(), turn);

    expect(own.ok).toBe(true);
    expect(candidates.map((c) => c.reference)).not.toContain(closed);
    expect(candidates).toEqual([]);
  });

  it("proposes nothing without an identified project, or to a sender who cannot reach the requests", async () => {
    await file(alice, "Panier vidé", "Le panier se vide.");

    const ambiguous = await turnFor(alice, "Le panier se vide.");
    const unverified = await turnFor(alice, "Sur le SHOP, le panier se vide.", {}, "UNVERIFIED");
    const otherOrganization = await turnFor(bruno, "Le portail plante.");

    expect(await findDuplicateCandidates(getAppDatabase(), ambiguous)).toEqual([]);
    expect(await findDuplicateCandidates(getAppDatabase(), unverified)).toEqual([]);
    expect(await findDuplicateCandidates(getAppDatabase(), otherOrganization)).toEqual([]);
  });
});

// A judge that always names the same request, and records its calls.
function judgeNaming(reference: string | null, confidence: number) {
  const calls: unknown[] = [];
  const judge = (input: unknown) => {
    calls.push(input);
    return Promise.resolve({ reference, confidence });
  };
  return { judge, calls };
}

describe("assessDuplicate", () => {
  it("keeps the request the model names, with its confidence", async () => {
    const cart = await file(alice, "Panier vidé", "Le panier se vide.");
    const turn = await turnFor(alice, "Sur le SHOP, le panier se vide.", { title: "Panier vidé" });
    const { judge, calls } = judgeNaming(cart, 0.9);

    const assessed = await assessDuplicate(getAppDatabase(), turn, judge);

    expect(assessed.duplicate).toEqual({ reference: cart, confidence: 0.9 });
    expect(calls).toHaveLength(1);
  });

  it("does not ask the model for a follow-up, or without candidates", async () => {
    await file(alice, "Panier vidé", "Le panier se vide.");
    const followUp = await turnFor(alice, "Sur le SHOP, toujours vide.", { type: "FOLLOW_UP" });
    const elsewhere = await turnFor(bruno, "Le portail plante.");
    const { judge, calls } = judgeNaming("REQ-0001", 0.9);

    expect((await assessDuplicate(getAppDatabase(), followUp, judge)).duplicate).toBeNull();
    expect((await assessDuplicate(getAppDatabase(), elsewhere, judge)).duplicate).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

describe("createRequest with a possible duplicate", () => {
  it("adds the message to the existing request when the model is confident", async () => {
    const cart = await file(alice, "Panier vidé", "Le panier se vide.");
    const turn = await turnFor(alice, "Sur le SHOP, le panier se vide encore.", {
      title: "Panier vidé",
    });

    const result = await createRequest(
      getAppDatabase(),
      { ...turn, duplicate: { reference: cart, confidence: 0.9 } },
      {},
    );

    expect(result).toMatchObject({
      ok: true,
      value: { created: false, duplicate: true, request: { reference: cart } },
    });
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
    const [added] = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "MESSAGE_ADDED"));
    expect(added?.data).toEqual({ reason: "DUPLICATE", confidence: 0.9 });
    const [message] = await getDatabase()
      .select()
      .from(messages)
      .where(eq(messages.id, turn.messageId));
    expect(message?.requestId).not.toBeNull();
  });

  it("files a new request linked to the candidate, for review, when the model is not confident", async () => {
    const cart = await file(alice, "Panier vidé", "Le panier se vide.");
    const turn = await turnFor(alice, "Sur le SHOP, le panier se vide encore.", {
      title: "Panier vidé",
    });

    const result = await createRequest(
      getAppDatabase(),
      { ...turn, duplicate: { reference: cart, confidence: 0.6 } },
      {},
    );

    expect(result).toMatchObject({
      ok: true,
      value: { created: true, request: { needsReview: true } },
    });
    const [original, second] = await getDatabase().select().from(requests).orderBy(requests.number);
    expect(second?.duplicateOfRequestId).toBe(original?.id);
    const classifiedEvents = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "CLASSIFIED"));
    expect(classifiedEvents.at(-1)?.data).toMatchObject({ reviewReasons: ["POSSIBLE_DUPLICATE"] });
  });
});
