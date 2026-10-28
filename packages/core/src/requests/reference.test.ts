import { describe, expect, it } from "vitest";

import { formatReference, parseReference } from "./reference.ts";

describe("formatReference", () => {
  it("pads short numbers to four digits", () => {
    expect(formatReference(42)).toBe("REQ-0042");
    expect(formatReference(12345)).toBe("REQ-12345");
  });
});

describe("parseReference", () => {
  it("reads the number of a reference, whatever its case and surrounding spaces", () => {
    expect(parseReference("REQ-0042")).toBe(42);
    expect(parseReference(" req-7 ")).toBe(7);
  });

  it("rejects anything else", () => {
    expect(parseReference("42")).toBeUndefined();
    expect(parseReference("REQ-")).toBeUndefined();
    expect(parseReference("REQ-0042; drop table requests")).toBeUndefined();
    expect(parseReference("REQ-1234567890")).toBeUndefined();
  });
});
