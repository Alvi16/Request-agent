import { describe, expect, it } from "vitest";

import { rawEmail } from "../../test/emails";
import { parseEmail } from "./parse";
import { isAutomatic, senderTrust } from "./policy";

const trusted = { trustedAuthservId: "mx.requests.example", trustAllSenders: false };

async function emailWith(headers: Record<string, string>, from = "alice.martin@acme.example") {
  return parseEmail(await rawEmail({ from, headers }));
}

describe("senderTrust", () => {
  it("verifies a sender that passed DMARC at our receiving server", async () => {
    const email = await emailWith({
      "Authentication-Results":
        "mx.requests.example; dkim=pass header.i=@acme.example; dmarc=pass (p=REJECT) header.from=acme.example",
    });

    expect(senderTrust(email, trusted)).toBe("VERIFIED");
  });

  it("reads the header that Gmail writes, with its comments and its other methods", async () => {
    // As received on 2026-10-30 by the Gmail account of the agent, with the addresses replaced.
    const email = await emailWith({
      "Authentication-Results":
        "mx.google.com;\r\n       dkim=pass header.i=@acme.example header.s=20260707 header.b=jf1ehd1E;\r\n       spf=pass (google.com: domain of bounce@mail.acme.example designates 209.85.220.69 as permitted sender) smtp.mailfrom=bounce@mail.acme.example;\r\n       dmarc=pass (p=REJECT sp=REJECT dis=NONE) header.from=acme.example;\r\n       dara=pass header.i=@gmail.com",
    });

    expect(senderTrust(email, { trustedAuthservId: "mx.google.com", trustAllSenders: false })).toBe(
      "VERIFIED",
    );
  });

  it("ignores a result written by another server, as a sender can forge one", async () => {
    const email = await emailWith({
      "Authentication-Results": "mx.evil.example; dmarc=pass header.from=acme.example",
    });

    expect(senderTrust(email, trusted)).toBe("UNVERIFIED");
  });

  it("does not verify a sender that failed DMARC, or another domain than the From address", async () => {
    const failed = await emailWith({
      "Authentication-Results": "mx.requests.example; dmarc=fail header.from=acme.example",
    });
    const otherDomain = await emailWith({
      "Authentication-Results": "mx.requests.example; dmarc=pass header.from=evil.example",
    });

    expect(senderTrust(failed, trusted)).toBe("UNVERIFIED");
    expect(senderTrust(otherDomain, trusted)).toBe("UNVERIFIED");
  });

  it("verifies nobody when no receiving server is trusted", async () => {
    const email = await emailWith({
      "Authentication-Results": "mx.requests.example; dmarc=pass header.from=acme.example",
    });

    expect(senderTrust(email, { trustedAuthservId: undefined, trustAllSenders: false })).toBe(
      "UNVERIFIED",
    );
    expect(senderTrust(await emailWith({}), trusted)).toBe("UNVERIFIED");
  });

  it("trusts every sender only when told to, for local tests", async () => {
    expect(
      senderTrust(await emailWith({}), { trustedAuthservId: undefined, trustAllSenders: true }),
    ).toBe("VERIFIED");
  });
});

describe("isAutomatic", () => {
  const own = "agent@requests.example";

  it("lets a message written by a person through", async () => {
    expect(isAutomatic(await emailWith({}), own)).toBe(false);
    expect(isAutomatic(await emailWith({ "Auto-Submitted": "no" }), own)).toBe(false);
  });

  it("recognizes automatic replies, mailing lists and bulk mail", async () => {
    expect(isAutomatic(await emailWith({ "Auto-Submitted": "auto-replied" }), own)).toBe(true);
    expect(isAutomatic(await emailWith({ Precedence: "bulk" }), own)).toBe(true);
    expect(isAutomatic(await emailWith({ "List-Id": "<team.acme.example>" }), own)).toBe(true);
  });

  it("recognizes robot senders and the agent itself", async () => {
    expect(isAutomatic(await emailWith({}, "MAILER-DAEMON@acme.example"), own)).toBe(true);
    expect(isAutomatic(await emailWith({}, "no-reply@acme.example"), own)).toBe(true);
    expect(isAutomatic(await emailWith({}, own), own)).toBe(true);
  });

  it("recognizes a no-reply address with a prefix or a tag", async () => {
    expect(isAutomatic(await emailWith({}, "billing-noreply@acme.example"), own)).toBe(true);
    expect(isAutomatic(await emailWith({}, "billing.do-not-reply@acme.example"), own)).toBe(true);
    expect(isAutomatic(await emailWith({}, "no-reply+alerts@acme.example"), own)).toBe(true);
  });

  it("lets through people whose address only contains a robot word", async () => {
    expect(isAutomatic(await emailWith({}, "noreen.ply@acme.example"), own)).toBe(false);
    expect(isAutomatic(await emailWith({}, "jean.postmaster@acme.example"), own)).toBe(false);
    expect(isAutomatic(await emailWith({}, "replynow@acme.example"), own)).toBe(false);
  });
});
