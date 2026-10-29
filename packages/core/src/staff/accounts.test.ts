import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { contacts, staffAccounts } from "../db/schema.ts";
import { authenticateStaff, saveStaffAccount, staffAccountInput } from "./accounts.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const password = "a long staff password";
const account = { email: "Dana.Support@Team.Example", name: "Dana Support", password };

let contactId: string;

beforeEach(async () => {
  contactId = await saveStaffAccount(getAppDatabase(), staffAccountInput.parse(account));
});

describe("staffAccountInput", () => {
  it("refuses a password shorter than 15 characters", () => {
    expect(staffAccountInput.safeParse({ ...account, password: "fourteen chars" }).success).toBe(
      false,
    );
  });
});

describe("saveStaffAccount", () => {
  it("creates the contact with a lowercase email and stores only a hash", async () => {
    const [stored] = await getDatabase()
      .select({ email: contacts.email, hash: staffAccounts.passwordHash })
      .from(staffAccounts)
      .innerJoin(contacts, eq(contacts.id, staffAccounts.contactId));

    expect(stored?.email).toBe("dana.support@team.example");
    expect(stored?.hash).toMatch(/^\$argon2id\$/);
  });

  it("sets a new password on the same contact and enables the account again", async () => {
    await getDatabase().update(staffAccounts).set({ disabledAt: new Date() });

    const again = await saveStaffAccount(
      getAppDatabase(),
      staffAccountInput.parse({ ...account, password: "another long password" }),
    );

    expect(again).toBe(contactId);
    await expect(
      authenticateStaff(getAppDatabase(), account.email, "another long password"),
    ).resolves.toMatchObject({ contactId });
    await expect(authenticateStaff(getAppDatabase(), account.email, password)).resolves.toBe(
      undefined,
    );
  });
});

describe("authenticateStaff", () => {
  it("returns the team member for the right email and password", async () => {
    await expect(
      authenticateStaff(getAppDatabase(), " dana.support@team.example ", password),
    ).resolves.toEqual({
      contactId,
      name: "Dana Support",
      email: "dana.support@team.example",
    });
  });

  it("refuses a wrong password, an unknown email and a disabled account", async () => {
    await expect(authenticateStaff(getAppDatabase(), account.email, "wrong")).resolves.toBe(
      undefined,
    );
    await expect(
      authenticateStaff(getAppDatabase(), "nobody@team.example", password),
    ).resolves.toBe(undefined);

    await getDatabase().update(staffAccounts).set({ disabledAt: new Date() });

    await expect(authenticateStaff(getAppDatabase(), account.email, password)).resolves.toBe(
      undefined,
    );
  });

  it("does not give an account to a contact who only writes to the agent", async () => {
    await getDatabase().insert(contacts).values({ email: "client@acme.example" });

    await expect(authenticateStaff(getAppDatabase(), "client@acme.example", "")).resolves.toBe(
      undefined,
    );
  });
});
