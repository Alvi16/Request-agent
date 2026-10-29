import { describe, expect, it } from "vitest";

import { rawEmail } from "../../test/emails";
import { parseEmail } from "./parse";

describe("parseEmail", () => {
  it("reads the sender, the recipients, the subject and the attached files", async () => {
    const email = await parseEmail(
      await rawEmail({
        cc: "Chloé <Chloe.Durand@initech.example>",
        attachments: [
          { filename: "capture.png", content: Buffer.alloc(2048, 1), contentType: "image/png" },
        ],
      }),
    );

    expect(email).toMatchObject({
      from: "alice.martin@acme.example",
      recipients: ["agent@requests.example", "chloe.durand@initech.example"],
      subject: "Bouton de validation cassé",
      text: "Le bouton de validation ne fonctionne plus.",
      inReplyTo: null,
      references: [],
      attachments: [{ filename: "capture.png", contentType: "image/png", sizeBytes: 2048 }],
    });
    expect(email.messageId).toMatch(/^<.+@.+>$/);
  });

  it("reads the thread of a reply, and keeps only what the sender just wrote", async () => {
    const email = await parseEmail(
      await rawEmail({
        subject: "Re: Bouton de validation cassé",
        text: "C'est sur le SHOP.\n\nLe mar. 28 oct. 2026 à 10:00, Request agent <agent@requests.example> a écrit :\n> Quel projet ?",
        inReplyTo: "<answer@requests.example>",
        references: ["<first@acme.example>", "<answer@requests.example>"],
      }),
    );

    expect(email).toMatchObject({
      text: "C'est sur le SHOP.",
      inReplyTo: "<answer@requests.example>",
      references: ["<first@acme.example>", "<answer@requests.example>"],
    });
    expect(email.fullText).toContain("Quel projet ?");
  });

  it("reads an email that only has an HTML version", async () => {
    const email = await parseEmail(
      await rawEmail({
        text: undefined,
        html: "<p>Le <b>panier</b> se vide &amp; le total est faux.</p><script>alert(1)</script>",
      }),
    );

    expect(email.text).toBe("Le panier se vide & le total est faux.");
  });

  it("gives a stable identity to an email without Message-ID", async () => {
    const source = new TextEncoder().encode(
      "From: alice.martin@acme.example\r\nTo: agent@requests.example\r\nSubject: Test\r\n\r\nBonjour\r\n",
    );

    const first = await parseEmail(source);
    const again = await parseEmail(source);

    expect(first.messageId).toBe(again.messageId);
    expect(first.messageId).toMatch(/@no-message-id>$/);
  });

  it("refuses an email without a sender", async () => {
    const source = new TextEncoder().encode(
      "To: agent@requests.example\r\nSubject: Test\r\n\r\nBonjour\r\n",
    );

    await expect(parseEmail(source)).rejects.toThrow(/no sender/);
  });
});
