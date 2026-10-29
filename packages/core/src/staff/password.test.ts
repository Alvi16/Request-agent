import { describe, expect, it } from "vitest";

import { hashPassword, verifyPassword } from "./password.ts";

describe("hashPassword", () => {
  it("stores an Argon2id hash with the OWASP parameters and a random salt", async () => {
    const first = await hashPassword("correct horse battery staple");
    const second = await hashPassword("correct horse battery staple");

    expect(first).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[\w+/]{22}\$[\w+/]{43}$/);
    expect(first).not.toBe(second);
    expect(first).not.toContain("staple");
  });
});

describe("verifyPassword", () => {
  it("accepts the right password and refuses any other", async () => {
    const stored = await hashPassword("correct horse battery staple");

    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(true);
    await expect(verifyPassword("correct horse battery stapler", stored)).resolves.toBe(false);
    await expect(verifyPassword("", stored)).resolves.toBe(false);
  });

  it("checks with the parameters stored in the hash", async () => {
    const stored = (await hashPassword("correct horse battery staple")).replace("t=2", "t=3");

    await expect(verifyPassword("correct horse battery staple", stored)).resolves.toBe(false);
  });

  it("refuses a hash in another format", async () => {
    await expect(verifyPassword("password", "plain-text")).rejects.toThrow(/Argon2id/);
  });
});
