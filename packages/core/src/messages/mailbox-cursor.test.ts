import { describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { getMailboxCursor, saveMailboxCursor } from "./mailbox-cursor.ts";

useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const mailbox = "imap://agent@requests.example@imap.requests.example/INBOX";

describe("mailbox cursor", () => {
  it("has no cursor for a mailbox never read", async () => {
    await expect(getMailboxCursor(getAppDatabase(), mailbox)).resolves.toBe(undefined);
  });

  it("keeps the last UID read, beyond the range of a 32-bit signed integer", async () => {
    await saveMailboxCursor(getAppDatabase(), mailbox, { uidValidity: 4_294_967_295, lastUid: 7 });
    await saveMailboxCursor(getAppDatabase(), mailbox, {
      uidValidity: 4_294_967_295,
      lastUid: 3_000_000_000,
    });

    await expect(getMailboxCursor(getAppDatabase(), mailbox)).resolves.toEqual({
      uidValidity: 4_294_967_295,
      lastUid: 3_000_000_000,
    });
  });

  it("never moves back while the UIDVALIDITY stays the same", async () => {
    await saveMailboxCursor(getAppDatabase(), mailbox, { uidValidity: 1, lastUid: 12 });
    await saveMailboxCursor(getAppDatabase(), mailbox, { uidValidity: 1, lastUid: 5 });

    await expect(getMailboxCursor(getAppDatabase(), mailbox)).resolves.toEqual({
      uidValidity: 1,
      lastUid: 12,
    });
  });

  it("starts again when the UIDVALIDITY changes", async () => {
    await saveMailboxCursor(getAppDatabase(), mailbox, { uidValidity: 1, lastUid: 12 });
    await saveMailboxCursor(getAppDatabase(), mailbox, { uidValidity: 2, lastUid: 3 });

    await expect(getMailboxCursor(getAppDatabase(), mailbox)).resolves.toEqual({
      uidValidity: 2,
      lastUid: 3,
    });
  });

  it("keeps one cursor per mailbox", async () => {
    await saveMailboxCursor(getAppDatabase(), mailbox, { uidValidity: 1, lastUid: 12 });

    await expect(getMailboxCursor(getAppDatabase(), `${mailbox}-other`)).resolves.toBe(undefined);
  });
});
