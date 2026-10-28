import { describe, expect, it } from "vitest";

import { loadDatabaseEnv, loadTestDatabaseEnv } from "./env.ts";

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
