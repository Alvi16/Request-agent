import { describe, expect, it } from "vitest";

import { loadEnv, loadSlackTokens } from "./config";

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

describe("loadSlackTokens", () => {
  const tokens = { SLACK_BOT_TOKEN: "xoxb-1", SLACK_APP_TOKEN: "xapp-1" };

  it("returns the two tokens when Slack is configured", () => {
    expect(loadSlackTokens(tokens)).toEqual({ botToken: "xoxb-1", appToken: "xapp-1" });
  });

  it("is undefined when Slack is not configured, including with empty values", () => {
    expect(loadSlackTokens({})).toBeUndefined();
    expect(loadSlackTokens({ SLACK_BOT_TOKEN: "", SLACK_APP_TOKEN: "" })).toBeUndefined();
  });

  it("rejects only one of the two tokens", () => {
    expect(() => loadSlackTokens({ SLACK_BOT_TOKEN: "xoxb-1" })).toThrow(/set together/);
  });

  it("rejects a token of the wrong kind, such as a user token", () => {
    expect(() => loadSlackTokens({ ...tokens, SLACK_BOT_TOKEN: "xoxp-1" })).toThrow(/xoxb-/);
  });
});
