import { eq, sql } from "drizzle-orm";

import type { Database } from "../db/client.ts";
import { mailboxCursors } from "../db/schema.ts";

export interface MailboxCursor {
  uidValidity: number;
  lastUid: number;
}

export async function getMailboxCursor(
  db: Database,
  mailbox: string,
): Promise<MailboxCursor | undefined> {
  const [row] = await db
    .select({ uidValidity: mailboxCursors.uidValidity, lastUid: mailboxCursors.lastUid })
    .from(mailboxCursors)
    .where(eq(mailboxCursors.mailbox, mailbox));
  return row;
}

// Moves the cursor forward, never back. A new UIDVALIDITY means the UIDs were renumbered, so the
// cursor starts again from the given UID.
export async function saveMailboxCursor(
  db: Database,
  mailbox: string,
  cursor: MailboxCursor,
): Promise<void> {
  await db
    .insert(mailboxCursors)
    .values({ mailbox, ...cursor })
    .onConflictDoUpdate({
      target: mailboxCursors.mailbox,
      set: {
        uidValidity: cursor.uidValidity,
        lastUid: sql`case when ${mailboxCursors.uidValidity} = ${cursor.uidValidity}
          then greatest(${mailboxCursors.lastUid}, ${cursor.lastUid}) else ${cursor.lastUid} end`,
        updatedAt: new Date(),
      },
    });
}
