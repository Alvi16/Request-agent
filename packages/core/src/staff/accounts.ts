import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../db/client.ts";
import { contacts, staffAccounts } from "../db/schema.ts";
import { hashPassword, verifyPassword } from "./password.ts";

// NIST SP 800-63B asks for at least 15 characters when the password is the only factor. The
// maximum keeps a sign-in attempt from costing too much.
export const minPasswordLength = 15;
const maxPasswordLength = 128;

export const staffAccountInput = z.object({
  email: z.email().max(254).toLowerCase(),
  name: z.string().trim().min(1).max(120),
  password: z.string().min(minPasswordLength).max(maxPasswordLength),
});

export type StaffAccountInput = z.infer<typeof staffAccountInput>;

export interface StaffMember {
  contactId: string;
  name: string | null;
  email: string | null;
}

// Hash compared when the email is unknown, so an answer takes as long for an unknown email as for
// a wrong password and does not tell which addresses have an account.
let unknownAccountHash: Promise<string> | undefined;

// Creates the account of a team member, or sets a new password and enables it again. The contact
// is found by email, or created.
export async function saveStaffAccount(db: Database, input: StaffAccountInput): Promise<string> {
  const passwordHash = await hashPassword(input.password);
  return db.transaction(async (tx) => {
    const [contact] = await tx
      .insert(contacts)
      .values({ email: input.email, name: input.name })
      .onConflictDoUpdate({ target: contacts.email, set: { name: sql`excluded.name` } })
      .returning({ id: contacts.id });
    if (contact === undefined) {
      throw new Error("The contact of the account was not stored");
    }
    await tx
      .insert(staffAccounts)
      .values({ contactId: contact.id, passwordHash })
      .onConflictDoUpdate({
        target: staffAccounts.contactId,
        set: { passwordHash, disabledAt: null },
      });
    return contact.id;
  });
}

// The team member with this email and password, if their account is enabled.
export async function authenticateStaff(
  db: Database,
  email: string,
  password: string,
): Promise<StaffMember | undefined> {
  const [account] = await db
    .select({
      contactId: contacts.id,
      name: contacts.name,
      email: contacts.email,
      passwordHash: staffAccounts.passwordHash,
    })
    .from(staffAccounts)
    .innerJoin(contacts, eq(contacts.id, staffAccounts.contactId))
    .where(and(eq(contacts.email, email.trim().toLowerCase()), isNull(staffAccounts.disabledAt)));
  if (account === undefined || password.length > maxPasswordLength) {
    unknownAccountHash ??= hashPassword("unknown account");
    await verifyPassword(password.slice(0, maxPasswordLength), await unknownAccountHash);
    return undefined;
  }
  if (!(await verifyPassword(password, account.passwordHash))) {
    return undefined;
  }
  return { contactId: account.contactId, name: account.name, email: account.email };
}
