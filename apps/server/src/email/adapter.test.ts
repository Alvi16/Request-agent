import {
  attachments,
  connectDatabase,
  conversations,
  messages,
  type TurnInput,
} from "@request-agent/core";
import { useAppTestDatabase, useTestDatabase } from "@request-agent/core/testing";
import type Mail from "nodemailer/lib/mailer";
import { afterAll, describe, expect, it } from "vitest";

import { rawEmail } from "../../test/emails";
import type { HandledMessage } from "../mastra/agents/handle-message";
import { type OutgoingEmail, startEmailAdapter, unavailableReply } from "./adapter";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const address = "agent@requests.example";

// A database nobody listens on, to make storing fail.
const unreachableDatabase = connectDatabase("postgresql://nobody:none@127.0.0.1:1/none");

afterAll(async () => {
  await unreachableDatabase.close();
});

// A mailbox the test fills, and a sender that records what the adapter sends.
async function fakeMail(
  handle: (input: TurnInput) => Promise<HandledMessage>,
  failingStore = false,
) {
  let deliver: ((mail: { uid: number; source: Uint8Array }) => Promise<void>) | undefined;
  const seen: number[] = [];
  const sent: OutgoingEmail[] = [];
  const handled: TurnInput[] = [];
  let uid = 0;
  const adapter = await startEmailAdapter({
    mailbox: {
      watch: (listener) => {
        deliver = listener;
        return Promise.resolve();
      },
      markSeen: (seenUid) => {
        seen.push(seenUid);
        return Promise.resolve();
      },
    },
    sender: {
      send: (email) => {
        sent.push(email);
        return Promise.resolve({ messageId: `<reply-${sent.length}@requests.example>` });
      },
    },
    db: failingStore ? unreachableDatabase.db : getAppDatabase(),
    handle: (input) => {
      handled.push(input);
      return handle(input);
    },
    address,
    trust: { trustedAuthservId: undefined, trustAllSenders: false },
    logger: { info: () => {}, error: () => {} },
  });

  async function receive(options: Mail.Options) {
    uid += 1;
    await deliver?.({ uid, source: await rawEmail(options) });
    await adapter.idle();
    return uid;
  }
  return { receive, seen, sent, handled };
}

const answered = (reply: string | null) => () => Promise.resolve({ reply, filedBySystem: false });

describe("startEmailAdapter", () => {
  it("stores an email, handles it, and answers in its thread", async () => {
    const mail = await fakeMail(
      answered("Votre demande est enregistrée sous la référence REQ-0001."),
    );

    const uid = await mail.receive({
      messageId: "<first@acme.example>",
      attachments: [
        { filename: "capture.png", content: Buffer.alloc(10), contentType: "image/png" },
      ],
    });

    expect(mail.seen).toEqual([uid]);
    expect(mail.handled).toEqual([
      { messageId: expect.any(String), trust: "UNVERIFIED", channelAddress: address },
    ]);
    expect(mail.sent).toEqual([
      {
        to: "alice.martin@acme.example",
        subject: "Re: Bouton de validation cassé [REQ-0001]",
        text: "Votre demande est enregistrée sous la référence REQ-0001.",
        inReplyTo: "<first@acme.example>",
        references: ["<first@acme.example>"],
      },
    ]);
    const stored = await getDatabase().select().from(messages);
    expect(stored.map((m) => m.direction)).toEqual(["INBOUND", "OUTBOUND"]);
    expect(await getDatabase().select().from(attachments)).toHaveLength(1);
  });

  it("attaches a reply to the conversation of the email it answers", async () => {
    const mail = await fakeMail(answered("ok"));
    await mail.receive({ messageId: "<first@acme.example>" });

    // A reply to the agent's answer, from a mail client that keeps only In-Reply-To.
    await mail.receive({
      messageId: "<second@acme.example>",
      inReplyTo: "<reply-1@requests.example>",
    });

    expect(await getDatabase().select().from(conversations)).toHaveLength(1);
    expect(mail.handled).toHaveLength(2);
  });

  it("uses an address dedicated to a project, such as a forwarded one", async () => {
    const mail = await fakeMail(answered("ok"));

    await mail.receive({ to: "Portal-Support@initech.example", cc: address });

    expect(mail.handled[0]?.channelAddress).toBe("portal-support@initech.example");
  });

  it("handles an email delivered twice only once", async () => {
    const mail = await fakeMail(answered("ok"));

    await mail.receive({ messageId: "<same@acme.example>" });
    await mail.receive({ messageId: "<same@acme.example>" });

    expect(mail.handled).toHaveLength(1);
    expect(mail.seen).toHaveLength(2);
  });

  it("keeps automatic emails without handling or answering them", async () => {
    const mail = await fakeMail(answered("ok"));

    await mail.receive({ headers: { "Auto-Submitted": "auto-replied" }, text: "Je suis absente." });
    await mail.receive({ from: "MAILER-DAEMON@acme.example", text: "Delivery failed" });

    expect(mail.handled).toHaveLength(0);
    expect(mail.sent).toHaveLength(0);
    expect(await getDatabase().select().from(messages)).toHaveLength(2);
  });

  it("sends nothing when no answer is needed, such as for thanks", async () => {
    const mail = await fakeMail(answered(null));

    await mail.receive({ text: "Merci beaucoup !" });

    expect(mail.sent).toHaveLength(0);
  });

  it("tells the sender when the email could not be handled", async () => {
    const mail = await fakeMail(() => Promise.reject(new Error("Ollama is down")));

    await mail.receive({});

    expect(mail.sent.map((email) => email.text)).toEqual([unavailableReply]);
  });

  it("leaves an email it could not store unread, so it is read again later", async () => {
    const mail = await fakeMail(answered("ok"), true);

    await mail.receive({});

    expect(mail.seen).toHaveLength(0);
  });
});
