// The two scenarios of the demonstration, from the channel to the stored request: the real
// adapters, message handler, tools and database, with only Slack, the mail servers and the model
// replaced by fakes.
import {
  type Classification,
  conversations,
  getRequestRecord,
  type RequestRecord,
  type TurnInput,
} from "@request-agent/core";
import {
  chloeSlackId,
  classified,
  seedDatabase,
  testReviewThreshold,
  useAppTestDatabase,
  useTestDatabase,
} from "@request-agent/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { rawEmail } from "../test/emails";
import { type ScriptedStep, scriptedModel } from "../test/scripted-model";
import { type OutgoingEmail, startEmailAdapter } from "./email/adapter";
import { type HandledMessage, handleMessage } from "./mastra/agents/handle-message";
import { createRequestAgent } from "./mastra/agents/request-agent";
import { type SlackEventSource, startSlackAdapter } from "./slack/adapter";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

const agentAddress = "agent@requests.example";
const brunoEmail = "Bruno Leroy <bruno.leroy@globex.example>";

type Handler = (input: TurnInput) => Promise<HandledMessage>;

// The message handler of the server, with a model that plays a script and a classifier that
// gives one fixed classification per message, in order.
function handlerFor(steps: ScriptedStep[], classifications: Partial<Classification>[]): Handler {
  const agent = createRequestAgent(scriptedModel(steps));
  let next = 0;
  const classify = () => {
    const classification = classifications[Math.min(next, classifications.length - 1)] ?? {};
    next += 1;
    return Promise.resolve(
      classified(
        { actor: { kind: "anonymous" }, messageId: "", project: { status: "unknown" } },
        classification,
      ).classification,
    );
  };
  return (input: TurnInput) =>
    handleMessage(agent, getAppDatabase(), input, {
      classify,
      judgeDuplicate: () => Promise.resolve({ reference: null, confidence: 1 }),
      reviewThreshold: testReviewThreshold,
    });
}

async function requestRecord(reference: string): Promise<RequestRecord> {
  const record = await getRequestRecord(getAppDatabase(), reference);
  if (record === undefined) {
    throw new Error(`${reference} was not stored`);
  }
  return record;
}

// The email adapter on a mailbox the test fills, with a sender that records the answers.
async function emailChannel(handle: Handler) {
  let deliver: ((mail: { uid: number; source: Uint8Array }) => Promise<void>) | undefined;
  const sent: OutgoingEmail[] = [];
  let uid = 0;
  const adapter = await startEmailAdapter({
    mailbox: {
      watch: (listener) => {
        deliver = listener;
        return Promise.resolve();
      },
      markSeen: () => Promise.resolve(),
    },
    sender: {
      send: (email) => {
        sent.push(email);
        return Promise.resolve({ messageId: `<reply-${sent.length}@requests.example>` });
      },
    },
    db: getAppDatabase(),
    handle,
    address: agentAddress,
    // The local mail server checks no sender: the demonstration trusts them, as in .env.example.
    trust: { trustedAuthservId: undefined, trustAllSenders: true },
    logger: { info: () => {}, error: () => {} },
    retryDelaysMs: [1, 1],
  });
  return {
    sent,
    receive: async (options: Parameters<typeof rawEmail>[0]) => {
      uid += 1;
      await deliver?.({ uid, source: await rawEmail(options) });
      await adapter.idle();
    },
  };
}

// The Slack adapter on a fake Slack that delivers mentions and records what is posted.
async function slackChannel(handle: Handler) {
  let mention: Parameters<SlackEventSource["on"]>[1] | undefined;
  const posted: { channel: string; threadTs: string; text: string }[] = [];
  const adapter = await startSlackAdapter({
    events: {
      on: (type, listener) => {
        if (type === "app_mention") {
          mention = listener;
        }
      },
    },
    web: {
      postInThread: (message) => {
        posted.push(message);
        return Promise.resolve({ ts: `1793000100.00000${posted.length}` });
      },
      addReaction: () => Promise.resolve(),
    },
    db: getAppDatabase(),
    handle,
    botUserId: "UBOT",
    teamId: "T1",
    logger: { info: () => {}, error: () => {} },
    retryDelaysMs: [1, 1],
  });
  return {
    posted,
    mention: async (event: Record<string, unknown>) => {
      await mention?.({ event: { type: "app_mention", ...event }, ack: () => Promise.resolve() });
      await adapter.idle();
    },
  };
}

describe("Email → Agent → Request", () => {
  it("files an email as a request of the sender's project, and answers with its reference", async () => {
    const mail = await emailChannel(
      handlerFor(
        [{ toolCalls: [{ tool: "create_request", input: {} }] }],
        [{ title: "Export PDF vide", priority: "HIGH" }],
      ),
    );

    await mail.receive({
      from: brunoEmail,
      messageId: "<export@globex.example>",
      subject: "Export des rapports",
      text: "L'export PDF des rapports mensuels génère un fichier vide depuis hier.",
    });

    expect(mail.sent).toEqual([
      expect.objectContaining({
        to: "bruno.leroy@globex.example",
        subject: "Re: Export des rapports [REQ-0001]",
        text: "Votre demande est enregistrée sous la référence REQ-0001.",
        inReplyTo: "<export@globex.example>",
      }),
    ]);
    const record = await requestRecord("REQ-0001");
    expect(record).toMatchObject({
      title: "Export PDF vide",
      type: "BUG",
      priority: "HIGH",
      projectKey: "PORTAL",
      sourceChannel: "EMAIL",
      needsReview: false,
      requesterContact: { email: "bruno.leroy@globex.example" },
    });
    expect(record.messages.map((message) => message.direction)).toEqual(["INBOUND", "OUTBOUND"]);
    expect(record.history.map((event) => event.type)).toEqual(["CREATED", "CLASSIFIED"]);
  });

  it("adds a reply in the same thread to the existing request, instead of a new one", async () => {
    const mail = await emailChannel(
      handlerFor(
        [
          { toolCalls: [{ tool: "create_request", input: {} }] },
          { toolCalls: [{ tool: "add_message_to_request", input: { reference: "REQ-0001" } }] },
        ],
        [{ title: "Export PDF vide" }, { type: "FOLLOW_UP", title: "Relance export PDF" }],
      ),
    );
    await mail.receive({
      from: brunoEmail,
      messageId: "<export@globex.example>",
      subject: "Export des rapports",
      text: "L'export PDF des rapports mensuels génère un fichier vide.",
    });

    await mail.receive({
      from: brunoEmail,
      messageId: "<follow-up@globex.example>",
      inReplyTo: "<reply-1@requests.example>",
      references: ["<export@globex.example>", "<reply-1@requests.example>"],
      subject: "Re: Export des rapports [REQ-0001]",
      text: "Nous avons toujours le problème. Où en êtes-vous ?",
    });

    // The reply belongs to the thread of the first email, and the agent knows it as a follow-up.
    expect(await getDatabase().select().from(conversations)).toHaveLength(1);
    await expect(getRequestRecord(getAppDatabase(), "REQ-0002")).resolves.toBe(undefined);
    const record = await requestRecord("REQ-0001");
    expect(record.messages.filter((message) => message.direction === "INBOUND")).toHaveLength(2);
    expect(record.history.at(-1)?.type).toBe("MESSAGE_ADDED");
    expect(mail.sent).toHaveLength(2);
  });
});

describe("Slack → Agent → Request", () => {
  it("files a mention in a project channel as a request, and answers in its thread", async () => {
    const workspace = await slackChannel(
      handlerFor(
        [{ toolCalls: [{ tool: "create_request", input: {} }] }],
        [{ title: "Paiement par carte refusé", priority: "CRITICAL" }],
      ),
    );

    // Chloé works on several projects: the channel dedicated to SHOP tells which one.
    await workspace.mention({
      channel: "C000000SHOP",
      ts: "1793000000.000100",
      user: chloeSlackId,
      text: "<@UBOT> les paiements par carte sont refusés depuis ce matin",
    });

    expect(workspace.posted).toEqual([
      {
        channel: "C000000SHOP",
        threadTs: "1793000000.000100",
        text: "Votre demande est enregistrée sous la référence REQ-0001.",
      },
    ]);
    const record = await requestRecord("REQ-0001");
    expect(record).toMatchObject({
      title: "Paiement par carte refusé",
      priority: "CRITICAL",
      projectKey: "SHOP",
      sourceChannel: "SLACK",
      needsReview: false,
      requesterContact: { name: "Chloé Durand" },
    });
    expect(record.messages.map((message) => [message.direction, message.bodyText])).toEqual([
      ["INBOUND", "les paiements par carte sont refusés depuis ce matin"],
      ["OUTBOUND", "Votre demande est enregistrée sous la référence REQ-0001."],
    ]);
  });
});
