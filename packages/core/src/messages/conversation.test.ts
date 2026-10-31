import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { bruno, classified } from "../../test/fixtures.ts";
import { seedDatabase } from "../db/seed.ts";
import { addMessageToRequest, createRequest } from "../requests/commands.ts";
import { prepareTurn } from "../requests/turn.ts";
import { conversationOrigin, readConversation } from "./conversation.ts";
import { markHandled } from "./handling.ts";
import { type ChannelMessage, storeInboundMessage, storeOutboundMessage } from "./inbox.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

let sequence = 0;

function widgetMessage(conversation: string, text: string): ChannelMessage {
  sequence += 1;
  return {
    channel: "WIDGET",
    conversationExternalId: conversation,
    externalId: `widget-${sequence}`,
    sender: bruno,
    bodyText: text,
    raw: { verified: true },
    sentAt: new Date(Date.UTC(2026, 9, 31, 9, sequence)),
  };
}

async function fileAsRequest(messageId: string) {
  const turn = await prepareTurn(getAppDatabase(), {
    messageId,
    trust: "VERIFIED",
    channelAddress: null,
  });
  return createRequest(getAppDatabase(), classified(turn, { title: "Export cassé" }), {});
}

describe("readConversation", () => {
  it("is undefined for a conversation that does not exist", async () => {
    expect(await readConversation(getAppDatabase(), "WIDGET", "nothing")).toBeUndefined();
  });

  it("waits while a message of the person is not handled", async () => {
    await storeInboundMessage(getAppDatabase(), {
      ...widgetMessage("c1", "L'export ne marche plus."),
      attachments: [
        { filename: "capture.png", contentType: "image/png", sizeBytes: 10, storageRef: "x" },
      ],
    });

    expect(await readConversation(getAppDatabase(), "WIDGET", "c1")).toEqual({
      messages: [
        {
          fromAgent: false,
          text: "L'export ne marche plus.",
          sentAt: expect.any(String),
          attachments: ["capture.png"],
        },
      ],
      requests: [],
      waiting: true,
    });
  });

  it("shows the answer of the agent and the request the message created, with its status", async () => {
    const question = widgetMessage("c2", "L'export ne marche plus.");
    const stored = await storeInboundMessage(getAppDatabase(), question);
    const created = await fileAsRequest(stored.messageId);
    await markHandled(getAppDatabase(), stored.messageId);
    await storeOutboundMessage(getAppDatabase(), {
      ...widgetMessage("c2", "Votre demande est enregistrée sous la référence REQ-0001."),
      sender: "agent",
      inReplyTo: question.externalId,
    });

    const thread = await readConversation(getAppDatabase(), "WIDGET", "c2");

    expect(created.ok).toBe(true);
    expect(thread?.waiting).toBe(false);
    expect(thread?.messages.map((message) => message.fromAgent)).toEqual([false, true]);
    expect(thread?.requests).toEqual([
      { reference: "REQ-0001", title: "Export cassé", status: "NEW" },
    ]);
  });

  it("does not show a request the message was only added to, which belongs to someone else", async () => {
    const other = await storeInboundMessage(getAppDatabase(), widgetMessage("other", "Panne"));
    await fileAsRequest(other.messageId);
    const stored = await storeInboundMessage(getAppDatabase(), widgetMessage("c3", "Même panne"));
    const turn = await prepareTurn(getAppDatabase(), {
      messageId: stored.messageId,
      trust: "VERIFIED",
      channelAddress: null,
    });
    await addMessageToRequest(getAppDatabase(), turn, { reference: "REQ-0001" });

    expect((await readConversation(getAppDatabase(), "WIDGET", "c3"))?.requests).toEqual([]);
  });
});

describe("conversationOrigin", () => {
  it("gives the sender and the channel data of the first message", async () => {
    await storeInboundMessage(getAppDatabase(), widgetMessage("c4", "Bonjour"));
    await storeInboundMessage(getAppDatabase(), {
      ...widgetMessage("c4", "Encore moi"),
      sender: "someone@else.example",
    });

    expect(await conversationOrigin(getAppDatabase(), "WIDGET", "c4")).toEqual({
      sender: bruno,
      raw: { verified: true },
    });
    expect(await conversationOrigin(getAppDatabase(), "WIDGET", "none")).toBeUndefined();
  });
});
