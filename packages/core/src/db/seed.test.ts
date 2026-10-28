import { count, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { useTestDatabase } from "../../test/database.ts";
import { contacts, organizations, projectContacts, projects } from "./schema.ts";
import { seedDatabase } from "./seed.ts";

const getDatabase = useTestDatabase();

describe("seedDatabase", () => {
  it("can run twice without duplicating data", async () => {
    const db = getDatabase();
    await seedDatabase(db);
    await seedDatabase(db);

    const [organizationCount] = await db.select({ value: count() }).from(organizations);
    const [contactCount] = await db.select({ value: count() }).from(contacts);
    const [linkCount] = await db.select({ value: count() }).from(projectContacts);
    expect(organizationCount?.value).toBe(3);
    expect(contactCount?.value).toBe(3);
    expect(linkCount?.value).toBe(6);
  });

  it("includes a contact working on two projects, to exercise ambiguity", async () => {
    const db = getDatabase();
    await seedDatabase(db);

    const rows = await db
      .select({ key: projects.key })
      .from(projectContacts)
      .innerJoin(projects, eq(projects.id, projectContacts.projectId))
      .innerJoin(contacts, eq(contacts.id, projectContacts.contactId))
      .where(eq(contacts.email, "alice.martin@acme.example"))
      .orderBy(projects.key);
    expect(rows.map((row) => row.key)).toEqual(["CRM", "SHOP"]);
  });
});
