import { createHash, randomBytes } from "node:crypto";

import { and, eq, gt, isNull } from "drizzle-orm";

import type { Database } from "../db/client.ts";
import { contacts, staffAccounts, staffSessions } from "../db/schema.ts";
import type { StaffMember } from "./accounts.ts";

// A session ends after a working day, even if it is still used: OWASP Session Management Cheat
// Sheet, absolute timeout.
export const sessionDurationMs = 8 * 60 * 60 * 1000;
// 256 random bits, far more than the 64 bits OWASP asks for.
const tokenBytes = 32;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

// Opens a session and returns the token for the cookie. Only its hash is stored.
export async function openSession(
  db: Database,
  contactId: string,
  now = new Date(),
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(tokenBytes).toString("base64url");
  const expiresAt = new Date(now.getTime() + sessionDurationMs);
  await db.insert(staffSessions).values({ contactId, tokenHash: hashToken(token), expiresAt });
  return { token, expiresAt };
}

// The team member of a session still open, with an enabled account.
export async function findSession(
  db: Database,
  token: string,
  now = new Date(),
): Promise<StaffMember | undefined> {
  const [session] = await db
    .select({ contactId: contacts.id, name: contacts.name, email: contacts.email })
    .from(staffSessions)
    .innerJoin(staffAccounts, eq(staffAccounts.contactId, staffSessions.contactId))
    .innerJoin(contacts, eq(contacts.id, staffSessions.contactId))
    .where(
      and(
        eq(staffSessions.tokenHash, hashToken(token)),
        isNull(staffSessions.revokedAt),
        gt(staffSessions.expiresAt, now),
        isNull(staffAccounts.disabledAt),
      ),
    );
  return session;
}

export async function closeSession(db: Database, token: string): Promise<void> {
  await db
    .update(staffSessions)
    .set({ revokedAt: new Date() })
    .where(and(eq(staffSessions.tokenHash, hashToken(token)), isNull(staffSessions.revokedAt)));
}
