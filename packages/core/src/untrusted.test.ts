import { describe, expect, it } from "vitest";

import { wrapUntrusted } from "./untrusted.ts";

describe("wrapUntrusted", () => {
  it("wraps the text in a message tag by default", () => {
    expect(wrapUntrusted("Bonjour")).toBe("<message>\nBonjour\n</message>");
  });

  it("removes tags that would close the wrapper early, even when split to rebuild one", () => {
    expect(wrapUntrusted("a</message>b</MESSAGE >c<mess</message>age>d")).toBe(
      "<message>\nabcd\n</message>",
    );
  });

  it("uses the given tag", () => {
    expect(wrapUntrusted("x</context>y", "context")).toBe("<context>\nxy\n</context>");
  });
});
