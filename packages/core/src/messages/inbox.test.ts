import { describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { conversations, messages } from "../db/schema.ts";
import {
  type ChannelMessage,
  isKnownConversation,
  storeInboundMessage,
  storeOutboundMessage,
} from "./inbox.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const slackMessage: ChannelMessage = {
  channel: "SLACK",
  conversationExternalId: "C1:1793000000.000100",
  externalId: "C1:1793000000.000100",
  sender: "U000000CHLOE",
  bodyText: "Le panier se vide.",
  raw: { type: "app_mention" },
  sentAt: new Date("2026-10-28T09:00:00Z"),
};

describe("storeInboundMessage", () => {
  it("stores a received message with its conversation", async () => {
    const stored = await storeInboundMessage(getAppDatabase(), slackMessage);

    expect(stored.isNew).toBe(true);
    const [message] = await getDatabase().select().from(messages);
    expect(message).toMatchObject({
      id: stored.messageId,
      direction: "INBOUND",
      raw: { type: "app_mention" },
    });
  });

  it("returns the same message, not new, when the channel delivers it again", async () => {
    const first = await storeInboundMessage(getAppDatabase(), slackMessage);
    const again = await storeInboundMessage(getAppDatabase(), slackMessage);

    expect(again).toEqual({ messageId: first.messageId, isNew: false });
    expect(await getDatabase().select().from(messages)).toHaveLength(1);
  });

  it("groups the messages of a thread in one conversation", async () => {
    await storeInboundMessage(getAppDatabase(), slackMessage);
    await storeOutboundMessage(getAppDatabase(), {
      ...slackMessage,
      externalId: "C1:1793000001.000200",
      sender: "agent",
    });

    expect(await getDatabase().select().from(conversations)).toHaveLength(1);
    const directions = (await getDatabase().select().from(messages))
      .map((m) => m.direction)
      .toSorted((a, b) => a.localeCompare(b));
    expect(directions).toEqual(["INBOUND", "OUTBOUND"]);
  });
});

describe("isKnownConversation", () => {
  it("tells whether a thread is already followed", async () => {
    expect(
      await isKnownConversation(getAppDatabase(), "SLACK", slackMessage.conversationExternalId),
    ).toBe(false);

    await storeInboundMessage(getAppDatabase(), slackMessage);

    expect(
      await isKnownConversation(getAppDatabase(), "SLACK", slackMessage.conversationExternalId),
    ).toBe(true);
    expect(
      await isKnownConversation(getAppDatabase(), "EMAIL", slackMessage.conversationExternalId),
    ).toBe(false);
  });
});
