import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { alice, bruno, classified, storeMessage } from "../../test/fixtures.ts";
import { attachments, contacts, conversations, events, messages, requests } from "../db/schema.ts";
import { seedDatabase } from "../db/seed.ts";
import { storeOutboundMessage } from "../messages/inbox.ts";
import { unclassifiedTurn } from "./classified-turn.ts";
import { addMessageToRequest, createRequest, fileUnhandledMessage } from "./commands.ts";
import {
  changeRequestStatus,
  consolePageSize,
  getRequestRecord,
  listProjects,
  listRequests,
  listRequestsInput,
} from "./console.ts";
import { formatReference } from "./reference.ts";
import { markDuplicate, type Reviewer } from "./review.ts";
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

// A request filed by a person from Slack, without the agent.
async function slackRequest(title: string) {
  const [row] = await getDatabase()
    .insert(requests)
    .values({ type: "SUPPORT", title, sourceChannel: "SLACK" })
    .returning({ number: requests.number });
  return formatReference(row?.number ?? 0);
}

// Bruno works on one project, so his requests are filed in PORTAL without review.
async function portalRequest(title: string, text = title) {
  const turn = await turnFor(bruno, text);
  const result = await createRequest(
    getAppDatabase(),
    classified(turn, { title, summary: text }, text),
    {},
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value.request.reference;
}

const list = (input: Parameters<typeof listRequestsInput.parse>[0] = {}) =>
  listRequests(getAppDatabase(), listRequestsInput.parse(input));

const found = async (query: string) => (await list({ query })).items.map((item) => item.reference);

describe("listRequestsInput", () => {
  it("reads a query string where empty fields mean no filter", () => {
    expect(
      listRequestsInput.parse({ query: "", status: "", projectKey: "portal", needsReview: "true" }),
    ).toEqual({ projectKey: "portal", needsReview: true, page: 1 });
  });

  it("refuses values outside the lists", () => {
    expect(listRequestsInput.safeParse({ status: "DONE" }).success).toBe(false);
    expect(listRequestsInput.safeParse({ page: "0" }).success).toBe(false);
    expect(listRequestsInput.safeParse({ projectKey: "x'; drop" }).success).toBe(false);
  });
});

describe("listRequests", () => {
  it("lists every request, last updated first, with its requester and source", async () => {
    const first = await portalRequest("Erreur 500 sur le portail");
    const second = await slackRequest("Accès au portail");

    const { items, total } = await list();

    expect(total).toBe(2);
    expect(items.map((item) => item.reference)).toEqual([second, first]);
    expect(items[0]).toMatchObject({ sourceChannel: "SLACK", requester: null, confidence: null });
    expect(items[1]).toMatchObject({
      projectKey: "PORTAL",
      requester: "Bruno Leroy",
      sourceChannel: "EMAIL",
      confidence: 0.9,
      needsReview: false,
    });
  });

  it("filters by status, type, channel, project and review", async () => {
    const slack = await slackRequest("Accès au portail");
    await portalRequest("Erreur 500 sur le portail");
    const waiting = await fileUnhandledMessage(
      getAppDatabase(),
      await unclassifiedTurn(getAppDatabase(), await turnFor(alice, "Le bouton ne marche plus.")),
    );

    expect((await list({ channel: "SLACK" })).items.map((item) => item.reference)).toEqual([slack]);
    expect((await list({ needsReview: "true" })).items.map((item) => item.reference)).toEqual([
      waiting?.reference,
    ]);
    expect((await list({ type: "OTHER" })).total).toBe(1);
    expect((await list({ projectKey: "portal" })).total).toBe(1);
    expect((await list({ status: "CLOSED" })).total).toBe(0);
  });

  it("searches words in French and references", async () => {
    const pdf = await portalRequest("Export PDF vide", "Les exports PDF des factures sont vides");
    const crash = await portalRequest("Erreur 500 sur le portail");

    expect((await list({ query: "facture" })).items.map((item) => item.reference)).toEqual([pdf]);
    expect(
      (await list({ query: crash.toLowerCase() })).items.map((item) => item.reference),
    ).toEqual([crash]);
    expect((await list({ query: "paiement" })).total).toBe(0);
  });

  it("finds parts of words, whatever their accents and case, as a search box does", async () => {
    const payment = await portalRequest("Paiement par carte en échec");
    const button = await portalRequest("Bouton de validation non fonctionnel");

    expect(await found("paie")).toEqual([payment]);
    expect(await found("ECHEC")).toEqual([payment]);
    expect(await found("vali bout")).toEqual([button]);
    expect(await found("carte bouton")).toEqual([]);
    expect(await found(button.slice(-4))).toEqual([button]);
    expect(await found("leroy")).toEqual(expect.arrayContaining([payment, button]));
  });

  it("takes the wildcards of a search literally", async () => {
    await portalRequest("Erreur 500 sur le portail");

    expect((await list({ query: "%" })).total).toBe(0);
    expect((await list({ query: "_" })).total).toBe(0);
    expect((await list({ query: "\\" })).total).toBe(0);
  });

  it("puts the titles closest to a partial search first", async () => {
    const mention = await portalRequest(
      "Erreur 500",
      "Le paiement a échoué juste après la commande",
    );
    const title = await portalRequest("Paiement refusé");

    expect((await list({ query: "paiem" })).items.map((item) => item.reference)).toEqual([
      title,
      mention,
    ]);
  });

  it("returns one page at a time with the total", async () => {
    const turn = await turnFor(bruno, "Premier message");
    await createRequest(getAppDatabase(), classified(turn), {});
    await getDatabase()
      .insert(requests)
      .values(
        Array.from({ length: consolePageSize }, (_, index) => ({
          type: "BUG" as const,
          title: `Demande ${index}`,
          sourceChannel: "EMAIL" as const,
        })),
      );

    const firstPage = await list();
    const secondPage = await list({ page: "2" });

    expect(firstPage.total).toBe(consolePageSize + 1);
    expect(firstPage.items).toHaveLength(consolePageSize);
    expect(secondPage.items).toHaveLength(1);
  });
});

describe("getRequestRecord", () => {
  it("gives the fields, requester, messages with attachments and full history", async () => {
    const reference = await portalRequest("Erreur 500 sur le portail");
    const [message] = await getDatabase().select({ id: messages.id }).from(messages);
    await getDatabase()
      .insert(attachments)
      .values({
        messageId: message?.id ?? "",
        filename: "capture.png",
        contentType: "image/png",
        sizeBytes: 2048,
      });
    const followUp = await turnFor(bruno, "Toujours en erreur ce matin.");
    await addMessageToRequest(getAppDatabase(), followUp, { reference });

    const record = await getRequestRecord(getAppDatabase(), reference.toLowerCase());

    expect(record).toMatchObject({
      reference,
      projectKey: "PORTAL",
      projectName: "Globex customer portal",
      requesterContact: {
        name: "Bruno Leroy",
        email: "bruno.leroy@globex.example",
        organization: "Globex",
      },
      reviewReasons: [],
      duplicateOf: null,
    });
    expect(record?.messages.map((item) => item.bodyText)).toEqual([
      "Erreur 500 sur le portail",
      "Toujours en erreur ce matin.",
    ]);
    expect(record?.messages[0]?.attachments).toEqual([
      { filename: "capture.png", contentType: "image/png", sizeBytes: 2048 },
    ]);
    expect(record?.history.map((event) => event.type)).toEqual([
      "CREATED",
      "CLASSIFIED",
      "MESSAGE_ADDED",
    ]);
    expect(record?.history[0]).toMatchObject({ actorType: "AGENT", channel: "EMAIL" });
  });

  it("includes the answers of the agent, not other messages of the conversation", async () => {
    const reference = await portalRequest("Erreur 500 sur le portail");
    const [question] = await getDatabase()
      .select({ externalId: messages.externalId, thread: conversations.externalId })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId));
    const answer = (externalId: string, inReplyTo: string, bodyText: string) =>
      storeOutboundMessage(getAppDatabase(), {
        channel: "EMAIL",
        conversationExternalId: question?.thread ?? "",
        externalId,
        sender: "agent@requests.example",
        bodyText,
        raw: {},
        sentAt: new Date(Date.UTC(2026, 9, 27)),
        inReplyTo,
      });
    await answer("answer-1", question?.externalId ?? "", "Votre demande est enregistrée.");
    await answer("answer-2", "another-message", "Réponse à un autre message.");

    const record = await getRequestRecord(getAppDatabase(), reference);

    expect(record?.messages.map((item) => [item.direction, item.bodyText])).toEqual([
      ["INBOUND", "Erreur 500 sur le portail"],
      ["OUTBOUND", "Votre demande est enregistrée."],
    ]);
  });

  it("names the person behind a human action and links duplicates both ways", async () => {
    const original = await portalRequest("Erreur 500 sur le portail");
    const repeated = await portalRequest("Le portail plante");
    await markDuplicate(getAppDatabase(), reviewer, {
      reference: repeated,
      duplicateOf: original,
    });

    const record = await getRequestRecord(getAppDatabase(), repeated);
    const originalRecord = await getRequestRecord(getAppDatabase(), original);

    expect(record?.duplicateOf).toBe(original);
    expect(record?.history.at(-1)).toMatchObject({
      actorType: "HUMAN",
      actorName: "Chloé Durand",
    });
    expect(originalRecord?.duplicates).toEqual([repeated]);
  });

  it("gives the reasons of a request waiting for review", async () => {
    const waiting = await fileUnhandledMessage(
      getAppDatabase(),
      await unclassifiedTurn(getAppDatabase(), await turnFor(alice, "Le bouton ne marche plus.")),
    );

    const record = await getRequestRecord(getAppDatabase(), waiting?.reference ?? "");

    expect(record?.needsReview).toBe(true);
    expect(record?.reviewReasons).toContain("UNHANDLED");
  });

  it("finds nothing for an unknown or malformed reference", async () => {
    await expect(getRequestRecord(getAppDatabase(), "REQ-9999")).resolves.toBe(undefined);
    await expect(getRequestRecord(getAppDatabase(), "9999")).resolves.toBe(undefined);
  });
});

describe("listProjects", () => {
  it("lists every project by key", async () => {
    await expect(listProjects(getAppDatabase())).resolves.toEqual([
      { key: "CRM", name: "Acme customer relationship management" },
      { key: "PORTAL", name: "Globex customer portal" },
      { key: "SHOP", name: "Acme online shop" },
    ]);
  });
});

describe("changeRequestStatus", () => {
  it("changes the status and records who did it", async () => {
    const reference = await portalRequest("Erreur 500 sur le portail");

    const result = await changeRequestStatus(getAppDatabase(), reviewer, {
      reference,
      status: "IN_PROGRESS",
    });

    expect(result).toEqual({ ok: true, value: "IN_PROGRESS" });
    const history = await getDatabase()
      .select({ type: events.type, actor: events.actorContactId, data: events.data })
      .from(events)
      .where(eq(events.type, "STATUS_CHANGED"));
    expect(history).toEqual([
      {
        type: "STATUS_CHANGED",
        actor: reviewer.contactId,
        data: { from: "NEW", to: "IN_PROGRESS" },
      },
    ]);
  });

  it("records nothing when the status does not change", async () => {
    const reference = await portalRequest("Erreur 500 sur le portail");

    await changeRequestStatus(getAppDatabase(), reviewer, { reference, status: "NEW" });

    const changes = await getDatabase()
      .select()
      .from(events)
      .where(eq(events.type, "STATUS_CHANGED"));
    expect(changes).toEqual([]);
  });

  it("answers not found for an unknown request", async () => {
    await expect(
      changeRequestStatus(getAppDatabase(), reviewer, { reference: "REQ-9999", status: "CLOSED" }),
    ).resolves.toEqual({ ok: false, error: "NOT_FOUND" });
  });
});
