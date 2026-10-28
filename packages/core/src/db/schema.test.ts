import { desc, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../../test/database.ts";
import type { Database } from "./client.ts";
import { contacts, conversations, events, messages, projects, requests } from "./schema.ts";

const getDatabase = useTestDatabase();

async function insertRequest(db: Database, values: Partial<typeof requests.$inferInsert> = {}) {
  const [request] = await db
    .insert(requests)
    .values({ type: "BUG", title: "Bouton de validation cassé", sourceChannel: "EMAIL", ...values })
    .returning();
  if (request === undefined) {
    throw new Error("The request was not inserted");
  }
  return request;
}

async function insertEmailConversation(db: Database) {
  const [conversation] = await db
    .insert(conversations)
    .values({ channel: "EMAIL", externalId: "<thread-1@acme.example>" })
    .returning();
  if (conversation === undefined) {
    throw new Error("The conversation was not inserted");
  }
  return conversation;
}

function emailMessage(conversationId: string) {
  return {
    conversationId,
    channel: "EMAIL" as const,
    externalId: "<message-1@acme.example>",
    direction: "INBOUND" as const,
    sender: "alice.martin@acme.example",
    bodyText: "Le bouton de validation ne fonctionne plus.",
    raw: { headers: { subject: "Bouton cassé" } },
    sentAt: new Date("2026-10-26T09:00:00Z"),
  };
}

describe("requests", () => {
  it("gets sequential numbers and the NEW status by default", async () => {
    const db = getDatabase();
    const first = await insertRequest(db);
    const second = await insertRequest(db);

    expect(first.number).toBe(1);
    expect(second.number).toBe(2);
    expect(first.status).toBe("NEW");
    expect(first.needsReview).toBe(false);
  });

  it("rejects a confidence outside 0 to 1", async () => {
    await expect(insertRequest(getDatabase(), { confidence: 1.5 })).rejects.toMatchObject({
      cause: { constraint: "requests_confidence_range" },
    });
  });

  it("rejects a request marked as a duplicate of itself", async () => {
    const db = getDatabase();
    const request = await insertRequest(db);

    await expect(
      db
        .update(requests)
        .set({ duplicateOfRequestId: request.id })
        .where(eq(requests.id, request.id)),
    ).rejects.toMatchObject({ cause: { constraint: "requests_not_duplicate_of_itself" } });
  });

  it("finds requests by French words, whatever their inflection", async () => {
    const db = getDatabase();
    await insertRequest(db, { title: "Erreur sur la page de paiement" });
    await insertRequest(db, {
      title: "Lenteur du tableau de bord",
      description: "Les paiements récents mettent du temps à s'afficher.",
    });
    await insertRequest(db, { title: "Logo à changer" });

    const query = sql`websearch_to_tsquery('french', 'paiements')`;
    const found = await db
      .select({ title: requests.title })
      .from(requests)
      .where(sql`${requests.search} @@ ${query}`)
      .orderBy(desc(sql`ts_rank(${requests.search}, ${query})`));

    // A match in the title ranks above a match in the description.
    expect(found.map((row) => row.title)).toEqual([
      "Erreur sur la page de paiement",
      "Lenteur du tableau de bord",
    ]);
  });
});

describe("messages", () => {
  it("are stored only once per channel and external ID", async () => {
    const db = getDatabase();
    const conversation = await insertEmailConversation(db);
    await db.insert(messages).values(emailMessage(conversation.id));

    await expect(db.insert(messages).values(emailMessage(conversation.id))).rejects.toMatchObject({
      cause: { constraint: "messages_channel_external_id_key" },
    });
  });

  it("must use the channel of their conversation", async () => {
    const db = getDatabase();
    const conversation = await insertEmailConversation(db);

    await expect(
      db.insert(messages).values({ ...emailMessage(conversation.id), channel: "SLACK" }),
    ).rejects.toMatchObject({ cause: { constraint: "messages_conversation_fkey" } });
  });
});

describe("events", () => {
  it("cannot be updated or deleted", async () => {
    const db = getDatabase();
    const request = await insertRequest(db);
    await db.insert(events).values({ requestId: request.id, type: "CREATED", actorType: "AGENT" });

    await expect(
      db.update(events).set({ type: "UPDATED" }).where(eq(events.requestId, request.id)),
    ).rejects.toMatchObject({
      cause: { message: "events are append-only: UPDATE is not allowed" },
    });
    await expect(db.delete(events).where(eq(events.requestId, request.id))).rejects.toMatchObject({
      cause: { message: "events are append-only: DELETE is not allowed" },
    });
  });
});

describe("contacts and projects", () => {
  it("rejects a contact without email nor Slack identity", async () => {
    await expect(getDatabase().insert(contacts).values({ name: "Anonyme" })).rejects.toMatchObject({
      cause: { constraint: "contacts_has_identity" },
    });
  });

  it("rejects an email address that is not lowercase", async () => {
    await expect(
      getDatabase().insert(contacts).values({ email: "Alice.Martin@acme.example" }),
    ).rejects.toMatchObject({ cause: { constraint: "contacts_email_lowercase" } });
  });

  it("rejects a project key that is not a short uppercase code", async () => {
    await expect(
      getDatabase().insert(projects).values({ key: "shop", name: "Shop" }),
    ).rejects.toMatchObject({ cause: { constraint: "projects_key_format" } });
  });
});
