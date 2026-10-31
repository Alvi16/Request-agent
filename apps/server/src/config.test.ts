import { describe, expect, it } from "vitest";

import { loadEmailEnv, loadEnv, loadSlackTokens, loadWidgetEnv } from "./config";

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

describe("loadEmailEnv", () => {
  const local = {
    EMAIL_USER: "agent",
    EMAIL_PASSWORD: "secret",
    EMAIL_ADDRESS: "agent@requests.example",
    EMAIL_IMAP_HOST: "127.0.0.1",
    EMAIL_IMAP_PORT: "3143",
    EMAIL_SMTP_HOST: "127.0.0.1",
    EMAIL_SMTP_PORT: "3025",
    EMAIL_SECURE: "false",
  };

  it("is undefined when no mailbox is configured", () => {
    expect(loadEmailEnv({})).toBeUndefined();
  });

  it("reads the mailbox settings, with TLS and no sender trust by default", () => {
    const { EMAIL_SECURE: _secure, ...withoutSecure } = local;

    expect(loadEmailEnv(withoutSecure)).toMatchObject({
      EMAIL_IMAP_PORT: 3143,
      EMAIL_SECURE: true,
      EMAIL_TRUST_LOCAL_SENDERS: false,
    });
  });

  it("trusts every sender only for a mailbox on this machine", () => {
    expect(
      loadEmailEnv({ ...local, EMAIL_TRUST_LOCAL_SENDERS: "true" })?.EMAIL_TRUST_LOCAL_SENDERS,
    ).toBe(true);
    expect(() =>
      loadEmailEnv({
        ...local,
        EMAIL_IMAP_HOST: "imap.gmail.com",
        EMAIL_TRUST_LOCAL_SENDERS: "true",
      }),
    ).toThrow(/only allowed with a mailbox on this machine/);
  });

  it("rejects an invalid address", () => {
    expect(() => loadEmailEnv({ ...local, EMAIL_ADDRESS: "agent" })).toThrow(/EMAIL_ADDRESS/);
  });
});

describe("loadWidgetEnv", () => {
  const widget = {
    WIDGET_ALLOWED_ORIGINS: "https://portal.example.com, http://localhost:4114",
    ATTACHMENTS_DIR: "/var/lib/request-agent/attachments",
  };

  it("is undefined when no origin is set, so the server runs without the widget", () => {
    expect(loadWidgetEnv({})).toBeUndefined();
    expect(loadWidgetEnv({ WIDGET_ALLOWED_ORIGINS: "" })).toBeUndefined();
  });

  it("reads the origins, and no secret when none is set", () => {
    expect(loadWidgetEnv({ ...widget, WIDGET_IDENTITY_SECRET: "" })).toEqual({
      WIDGET_ALLOWED_ORIGINS: ["https://portal.example.com", "http://localhost:4114"],
      WIDGET_IDENTITY_SECRET: undefined,
      ATTACHMENTS_DIR: "/var/lib/request-agent/attachments",
    });
  });

  it("refuses an origin with a path, a short secret or a relative folder", () => {
    expect(() =>
      loadWidgetEnv({ ...widget, WIDGET_ALLOWED_ORIGINS: "https://portal.example.com/app" }),
    ).toThrow(/WIDGET_ALLOWED_ORIGINS/);
    expect(() => loadWidgetEnv({ ...widget, WIDGET_IDENTITY_SECRET: "short" })).toThrow(
      /WIDGET_IDENTITY_SECRET/,
    );
    expect(() => loadWidgetEnv({ ...widget, ATTACHMENTS_DIR: "attachments" })).toThrow(
      /ATTACHMENTS_DIR/,
    );
  });
});
