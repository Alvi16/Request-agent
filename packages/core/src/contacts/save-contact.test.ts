import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { contacts, organizations } from "../db/schema.ts";
import { seedDatabase } from "../db/seed.ts";
import { contactInput, projectKeysOfContact, saveContact } from "./save-contact.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const person = {
  email: " Emma.Petit@Example.com ",
  name: "Emma Petit",
  organization: "acme",
  projects: ["shop"],
};

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

async function organizationNameOf(contactId: string) {
  const [row] = await getDatabase()
    .select({ name: organizations.name, email: contacts.email })
    .from(contacts)
    .leftJoin(organizations, eq(organizations.id, contacts.organizationId))
    .where(eq(contacts.id, contactId));
  return row;
}

describe("contactInput", () => {
  it("refuses an invalid email and an empty name", () => {
    expect(contactInput.safeParse({ ...person, email: "emma" }).success).toBe(false);
    expect(contactInput.safeParse({ ...person, name: " " }).success).toBe(false);
  });
});

describe("saveContact", () => {
  it("registers the person with their organization and projects", async () => {
    const contactId = await saveContact(getAppDatabase(), contactInput.parse(person));

    await expect(organizationNameOf(contactId)).resolves.toEqual({
      name: "Acme",
      email: "emma.petit@example.com",
    });
    await expect(projectKeysOfContact(getAppDatabase(), contactId)).resolves.toEqual(["SHOP"]);
  });

  it("updates the same contact and adds projects to the ones already linked", async () => {
    const first = await saveContact(getAppDatabase(), contactInput.parse(person));

    const again = await saveContact(
      getAppDatabase(),
      contactInput.parse({ email: person.email, name: "Emma P.", projects: ["CRM"] }),
    );

    expect(again).toBe(first);
    await expect(organizationNameOf(first)).resolves.toMatchObject({ name: "Acme" });
    await expect(projectKeysOfContact(getAppDatabase(), first)).resolves.toEqual(["CRM", "SHOP"]);
  });

  it("refuses an unknown organization or project and stores nothing", async () => {
    await expect(
      saveContact(getAppDatabase(), contactInput.parse({ ...person, organization: "Acmee" })),
    ).rejects.toThrow('Unknown organization "Acmee". Known: Acme, Globex, Initech');
    await expect(
      saveContact(getAppDatabase(), contactInput.parse({ ...person, projects: ["SHOP", "SHOPP"] })),
    ).rejects.toThrow("Unknown project SHOPP. Known:");

    const stored = await getDatabase()
      .select()
      .from(contacts)
      .where(eq(contacts.email, "emma.petit@example.com"));
    expect(stored).toEqual([]);
  });
});
