import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { staffAccounts, staffSessions } from "../db/schema.ts";
import { saveStaffAccount } from "./accounts.ts";
import { closeSession, findSession, openSession, sessionDurationMs } from "./sessions.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

let contactId: string;

beforeEach(async () => {
  contactId = await saveStaffAccount(getAppDatabase(), {
    email: "dana.support@team.example",
    name: "Dana Support",
    password: "a long staff password",
  });
});

describe("openSession", () => {
  it("returns a random token and stores only its hash", async () => {
    const first = await openSession(getAppDatabase(), contactId);
    const second = await openSession(getAppDatabase(), contactId);

    const stored = await getDatabase()
      .select({ hash: staffSessions.tokenHash })
      .from(staffSessions);
    expect(first.token).toMatch(/^[\w-]{43}$/);
    expect(first.token).not.toBe(second.token);
    expect(stored.map((row) => row.hash)).not.toContain(first.token);
    expect(stored).toHaveLength(2);
  });
});

describe("findSession", () => {
  it("finds the team member of an open session", async () => {
    const { token } = await openSession(getAppDatabase(), contactId);

    await expect(findSession(getAppDatabase(), token)).resolves.toEqual({
      contactId,
      name: "Dana Support",
      email: "dana.support@team.example",
    });
    await expect(findSession(getAppDatabase(), `${token}x`)).resolves.toBe(undefined);
  });

  it("ends the session after its duration", async () => {
    const opened = new Date("2026-10-29T08:00:00Z");
    const { token } = await openSession(getAppDatabase(), contactId, opened);

    const justBefore = new Date(opened.getTime() + sessionDurationMs - 1);
    await expect(findSession(getAppDatabase(), token, justBefore)).resolves.toBeDefined();
    const atTheEnd = new Date(opened.getTime() + sessionDurationMs);
    await expect(findSession(getAppDatabase(), token, atTheEnd)).resolves.toBe(undefined);
  });

  it("ends the sessions of a disabled account", async () => {
    const { token } = await openSession(getAppDatabase(), contactId);

    await getDatabase().update(staffAccounts).set({ disabledAt: new Date() });

    await expect(findSession(getAppDatabase(), token)).resolves.toBe(undefined);
  });
});

describe("closeSession", () => {
  it("ends only the session that signs out", async () => {
    const signedOut = await openSession(getAppDatabase(), contactId);
    const other = await openSession(getAppDatabase(), contactId);

    await closeSession(getAppDatabase(), signedOut.token);

    await expect(findSession(getAppDatabase(), signedOut.token)).resolves.toBe(undefined);
    await expect(findSession(getAppDatabase(), other.token)).resolves.toBeDefined();
  });
});
