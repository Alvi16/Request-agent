import { messages, requests, storeInboundMessage, type TurnInput } from "@request-agent/core";
import { useAppTestDatabase, useTestDatabase } from "@request-agent/core/testing";
import { describe, expect, it } from "vitest";

import type { HandledMessage } from "../mastra/agents/handle-message";
import { type SlackEventSource, startSlackAdapter } from "./adapter";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const botUserId = "UBOT";
const teamId = "T1";

type Listener = Parameters<SlackEventSource["on"]>[1];

// A Slack that delivers the events the test sends, and records what the adapter posts.
async function fakeSlack(handle: (input: TurnInput) => Promise<HandledMessage>) {
  const listeners = new Map<string, Listener>();
  const posted: { channel: string; threadTs: string; text: string }[] = [];
  const reactions: string[] = [];
  const handled: TurnInput[] = [];
  let next = 0;
  const adapter = await startSlackAdapter({
    events: { on: (type, listener) => listeners.set(type, listener) },
    web: {
      postInThread: (message) => {
        posted.push(message);
        next += 1;
        return Promise.resolve({ ts: `1793000100.00000${next}` });
      },
      addReaction: ({ name }) => {
        reactions.push(name);
        return Promise.resolve();
      },
    },
    db: getAppDatabase(),
    handle: (input) => {
      handled.push(input);
      return handle(input);
    },
    botUserId,
    teamId,
    logger: { info: () => {}, error: () => {} },
    // Retries come at once, so the tests do not wait.
    retryDelaysMs: [1, 1],
  });

  async function deliver(type: "app_mention" | "message", event: Record<string, unknown>) {
    let acked = false;
    const listener = listeners.get(type);
    if (listener === undefined) {
      throw new Error(`No listener for ${type}`);
    }
    await listener({
      event: { type, channel: "C1", ts: "1793000000.000100", user: "UALICE", ...event },
      ack: () => {
        acked = true;
        return Promise.resolve();
      },
    });
    await adapter.idle();
    return acked;
  }

  return { deliver, posted, reactions, handled, idle: adapter.idle };
}

const answered = (reply: string | null) => () => Promise.resolve({ reply, filedBySystem: false });

describe("startSlackAdapter", () => {
  it("stores a mention, handles it, and answers in its thread", async () => {
    const slack = await fakeSlack(
      answered("Votre demande est enregistrée sous la référence REQ-0001."),
    );

    const acked = await slack.deliver("app_mention", { text: "<@UBOT> le panier se vide" });

    expect(acked).toBe(true);
    expect(slack.reactions).toEqual(["eyes"]);
    expect(slack.handled).toEqual([
      { messageId: expect.any(String), trust: "VERIFIED", channelAddress: "C1" },
    ]);
    expect(slack.posted).toEqual([
      {
        channel: "C1",
        threadTs: "1793000000.000100",
        text: "Votre demande est enregistrée sous la référence REQ-0001.",
      },
    ]);
    const stored = await getDatabase().select().from(messages);
    expect(stored.map((m) => [m.direction, m.bodyText])).toEqual([
      ["INBOUND", "le panier se vide"],
      ["OUTBOUND", "Votre demande est enregistrée sous la référence REQ-0001."],
    ]);
    expect(stored[1]?.inReplyTo).toBe(stored[0]?.externalId);
  });

  it("handles a mention once, although Slack also sends it as a channel message", async () => {
    const slack = await fakeSlack(answered("ok"));

    await slack.deliver("app_mention", { text: "<@UBOT> le panier se vide" });
    await slack.deliver("message", { text: "<@UBOT> le panier se vide", channel_type: "channel" });

    expect(slack.handled).toHaveLength(1);
  });

  it("handles a direct message", async () => {
    const slack = await fakeSlack(answered("ok"));

    await slack.deliver("message", {
      channel: "D1",
      channel_type: "im",
      text: "où en est REQ-0001 ?",
    });

    expect(slack.handled).toHaveLength(1);
  });

  it("ignores channel messages outside the threads it follows, without storing them", async () => {
    const slack = await fakeSlack(answered("ok"));

    const acked = await slack.deliver("message", { channel_type: "channel", text: "pause café ?" });

    expect(acked).toBe(true);
    expect(slack.handled).toHaveLength(0);
    expect(await getDatabase().select().from(messages)).toHaveLength(0);
  });

  it("handles a reply in a thread it follows, without a mention", async () => {
    const slack = await fakeSlack(answered("Quel projet ?"));
    await slack.deliver("app_mention", { text: "<@UBOT> le bouton ne marche plus" });

    await slack.deliver("message", {
      channel_type: "channel",
      ts: "1793000200.000100",
      thread_ts: "1793000000.000100",
      text: "C'est sur le SHOP.",
    });

    expect(slack.handled).toHaveLength(2);
    expect(slack.posted.at(-1)?.threadTs).toBe("1793000000.000100");
  });

  it("handles a reply in a thread it follows in a private channel", async () => {
    const slack = await fakeSlack(answered("Quel projet ?"));
    await slack.deliver("app_mention", { channel: "G1", text: "<@UBOT> le bouton ne marche plus" });

    await slack.deliver("message", {
      channel: "G1",
      channel_type: "group",
      ts: "1793000200.000100",
      thread_ts: "1793000000.000100",
      text: "C'est sur le SHOP.",
    });

    expect(slack.handled).toHaveLength(2);
  });

  it("ignores bots, itself, edits and empty mentions", async () => {
    const slack = await fakeSlack(answered("ok"));

    await slack.deliver("message", { channel_type: "im", bot_id: "B1", text: "bot" });
    await slack.deliver("message", { channel_type: "im", user: botUserId, text: "moi" });
    await slack.deliver("message", {
      channel_type: "im",
      subtype: "message_changed",
      text: "édité",
    });
    await slack.deliver("app_mention", { text: "<@UBOT>" });

    expect(slack.handled).toHaveLength(0);
  });

  it("treats a sender of another organization as unverified", async () => {
    const slack = await fakeSlack(answered("ok"));

    await slack.deliver("app_mention", { text: "<@UBOT> bonjour", user_team: "T-OTHER" });

    expect(slack.handled[0]?.trust).toBe("UNVERIFIED");
  });

  it("posts nothing when no answer is needed, such as for thanks", async () => {
    const slack = await fakeSlack(answered(null));

    await slack.deliver("app_mention", { text: "<@UBOT> merci !" });

    expect(slack.posted).toHaveLength(0);
  });

  it("retries a failing message, then files it for a person and gives its reference", async () => {
    const slack = await fakeSlack(() => Promise.reject(new Error("Ollama is down")));

    await slack.deliver("app_mention", { text: "<@UBOT> le panier se vide" });

    expect(slack.handled).toHaveLength(3);
    expect(slack.posted.map((message) => message.text)).toEqual([
      "Votre message est enregistré sous la référence REQ-0001. Une personne de l'équipe va le traiter.",
    ]);
    const [request] = await getDatabase().select().from(requests);
    expect(request).toMatchObject({ type: "OTHER", needsReview: true });
  });

  it("handles at startup the messages stored before a restart but never handled", async () => {
    await storeInboundMessage(getAppDatabase(), {
      channel: "SLACK",
      conversationExternalId: "C1:1793000000.000100",
      externalId: "C1:1793000000.000100",
      sender: "UALICE",
      bodyText: "le panier se vide",
      raw: {
        type: "app_mention",
        channel: "C1",
        ts: "1793000000.000100",
        user: "UALICE",
        text: "<@UBOT> le panier se vide",
      },
      sentAt: new Date(),
    });

    const slack = await fakeSlack(answered("ok"));
    await slack.idle();

    expect(slack.handled).toHaveLength(1);
    expect(slack.posted.map((message) => message.threadTs)).toEqual(["1793000000.000100"]);
  });

  it("does not acknowledge an event it could not store, so Slack delivers it again", async () => {
    const slack = await fakeSlack(answered("ok"));

    const acked = await slack.deliver("app_mention", { text: "<@UBOT> texte", ts: "not-a-number" });

    expect(acked).toBe(false);
  });
});
