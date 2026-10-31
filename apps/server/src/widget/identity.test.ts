import { describe, expect, it } from "vitest";

import { maxIdentityLifetimeSeconds, signIdentity, verifyIdentity } from "./identity";

const secret = "a-secret-shared-with-the-application";
const now = new Date("2026-10-31T09:00:00Z");
const later = (seconds: number) => new Date(now.getTime() + seconds * 1000);

describe("signed identities", () => {
  it("verifies an identity signed with the secret, in lower case, until it expires", () => {
    const identity = signIdentity(secret, " Bruno.Leroy@Globex.example ", now);

    expect(identity.email).toBe("bruno.leroy@globex.example");
    expect(verifyIdentity(secret, identity, now)).toBe(true);
    expect(verifyIdentity(secret, identity, later(maxIdentityLifetimeSeconds - 1))).toBe(true);
    expect(verifyIdentity(secret, identity, later(maxIdentityLifetimeSeconds))).toBe(false);
  });

  it("refuses another email, another secret or a changed expiry", () => {
    const identity = signIdentity(secret, "bruno.leroy@globex.example", now);

    expect(verifyIdentity(secret, { ...identity, email: "alice.martin@acme.example" }, now)).toBe(
      false,
    );
    expect(verifyIdentity("another-secret", identity, now)).toBe(false);
    expect(verifyIdentity(secret, { ...identity, expires: identity.expires - 60 }, now)).toBe(
      false,
    );
  });

  it("refuses a signature that expires too far in the future", () => {
    const identity = signIdentity(secret, "bruno.leroy@globex.example", later(3600));

    expect(verifyIdentity(secret, identity, now)).toBe(false);
  });

  it("refuses a signature that is not hexadecimal of the right length", () => {
    const identity = signIdentity(secret, "bruno.leroy@globex.example", now);

    expect(verifyIdentity(secret, { ...identity, signature: "abc" }, now)).toBe(false);
  });
});
