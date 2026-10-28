import { describe, expect, it } from "vitest";

import {
  loadAppDatabaseEnv,
  loadClassifierEnv,
  loadDatabaseEnv,
  loadTestDatabaseEnv,
} from "./env.ts";

describe("loadDatabaseEnv", () => {
  it("returns the database URL when it is a PostgreSQL URL", () => {
    const env = { DATABASE_URL: "postgresql://user:secret@127.0.0.1:5433/request_agent" };
    expect(loadDatabaseEnv(env)).toEqual(env);
  });

  it("rejects a URL of another protocol", () => {
    expect(() => loadDatabaseEnv({ DATABASE_URL: "mysql://127.0.0.1/db" })).toThrow(/DATABASE_URL/);
  });

  it("rejects a missing URL", () => {
    expect(() => loadDatabaseEnv({})).toThrow(/DATABASE_URL/);
  });
});

describe("loadTestDatabaseEnv", () => {
  it("rejects a missing test database URL", () => {
    expect(() => loadTestDatabaseEnv({})).toThrow(/TEST_DATABASE_URL/);
  });
});

describe("loadAppDatabaseEnv", () => {
  it("returns the URL when it connects as the application role with a password", () => {
    const env = {
      APP_DATABASE_URL: "postgresql://request_agent_app:secret@127.0.0.1:5433/request_agent",
    };
    expect(loadAppDatabaseEnv(env)).toEqual(env);
  });

  it("rejects another role, which could have more rights", () => {
    const env = {
      APP_DATABASE_URL: "postgresql://request_agent:secret@127.0.0.1:5433/request_agent",
    };
    expect(() => loadAppDatabaseEnv(env)).toThrow(/request_agent_app/);
  });

  it("rejects a URL without a password", () => {
    const env = { APP_DATABASE_URL: "postgresql://request_agent_app@127.0.0.1:5433/request_agent" };
    expect(() => loadAppDatabaseEnv(env)).toThrow(/APP_DATABASE_URL/);
  });
});

describe("loadClassifierEnv", () => {
  const ollama = { OLLAMA_BASE_URL: "http://127.0.0.1:11434/api", OLLAMA_MODEL: "ornith:9b" };

  it("uses the measured review threshold by default", () => {
    expect(loadClassifierEnv(ollama).CLASSIFICATION_REVIEW_THRESHOLD).toBe(0.8);
  });

  it("reads a threshold between 0 and 1", () => {
    expect(
      loadClassifierEnv({ ...ollama, CLASSIFICATION_REVIEW_THRESHOLD: "0.9" })
        .CLASSIFICATION_REVIEW_THRESHOLD,
    ).toBe(0.9);
    expect(() => loadClassifierEnv({ ...ollama, CLASSIFICATION_REVIEW_THRESHOLD: "80" })).toThrow(
      /CLASSIFICATION_REVIEW_THRESHOLD/,
    );
  });
});
