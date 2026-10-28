import { beforeEach, describe, expect, it } from "vitest";

import { alice, bruno, classified, storeMessage } from "../../test/fixtures.ts";
import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import type { ClassificationInput } from "../classification/classifier.ts";
import { seedDatabase } from "../db/seed.ts";
import { classifyTurn, conversationContext } from "./classified-turn.ts";
import { createRequest } from "./commands.ts";
import { prepareTurn } from "./turn.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

async function turnFor(sender: string, bodyText: string, thread: string, subject?: string) {
  const messageId = await storeMessage(getDatabase(), { sender, bodyText, thread, subject });
  return prepareTurn(getAppDatabase(), { messageId, trust: "VERIFIED", channelAddress: null });
}

describe("conversationContext", () => {
  it("is empty for the first message of a conversation", async () => {
    const turn = await turnFor(bruno, "Le portail est lent.", "first");

    expect(await conversationContext(getAppDatabase(), turn)).toBe("");
  });

  it("gives the earlier messages, oldest first, and the request they are linked to", async () => {
    const first = await turnFor(bruno, "Le portail est lent.", "thread");
    await createRequest(getAppDatabase(), classified(first, { title: "Portail lent" }), {});
    const reply = await turnFor(bruno, "Toujours lent ce matin.", "thread");

    expect(await conversationContext(getAppDatabase(), reply)).toBe(
      "Sender: Le portail est lent.\nThis conversation is linked to request REQ-0001: Portail lent (status NEW).",
    );
  });

  it("does not reveal a linked request the sender cannot reach", async () => {
    const first = await turnFor(alice, "Le panier se vide.", "shared");
    await createRequest(getAppDatabase(), classified(first), {});
    const other = await turnFor(bruno, "Chez nous aussi.", "shared");

    expect(await conversationContext(getAppDatabase(), other)).toBe("Sender: Le panier se vide.");
  });
});

describe("classifyTurn", () => {
  it("classifies the subject and body of the message, with its conversation", async () => {
    await turnFor(bruno, "Le portail est lent.", "thread");
    const reply = await turnFor(bruno, "Toujours lent.", "thread", "Re: lenteur");
    const inputs: ClassificationInput[] = [];

    const turn = await classifyTurn(getAppDatabase(), reply, {
      reviewThreshold: 0.7,
      classify: (input) => {
        inputs.push(input);
        return Promise.resolve(classified(reply).classification);
      },
    });

    expect(inputs).toEqual([
      { text: "Re: lenteur\n\nToujours lent.", context: "Sender: Le portail est lent." },
    ]);
    expect(turn.reviewThreshold).toBe(0.7);
    expect(turn.messageText).toBe("Re: lenteur\n\nToujours lent.");
    expect(turn.classification.type).toBe("BUG");
  });
});
