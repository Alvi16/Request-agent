import { describe, expect, it } from "vitest";

import { loadEnv } from "./config";

const validEnv = {
  OLLAMA_BASE_URL: "http://127.0.0.1:11434/api",
  OLLAMA_MODEL: "ornith:9b",
};

describe("loadEnv", () => {
  it("returns the parsed configuration when every variable is valid", () => {
    expect(loadEnv(validEnv)).toEqual(validEnv);
  });

  it("rejects a base URL that is not a URL", () => {
    expect(() => loadEnv({ ...validEnv, OLLAMA_BASE_URL: "localhost" })).toThrow(/OLLAMA_BASE_URL/);
  });

  it("rejects a missing model", () => {
    expect(() => loadEnv({ OLLAMA_BASE_URL: validEnv.OLLAMA_BASE_URL })).toThrow(/OLLAMA_MODEL/);
  });
});
