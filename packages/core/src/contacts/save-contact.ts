import { eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database, Transaction } from "../db/client.ts";
import { contacts, organizations, projectContacts, projects } from "../db/schema.ts";

export const contactInput = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  name: z.string().trim().min(1).max(120),
  // Name of an existing organization, in any case.
  organization: z.string().trim().min(1).max(120).optional(),
  // Keys of existing projects, such as SHOP.
  projects: z.array(z.string().trim().toUpperCase().min(1)).default([]),
});

export type ContactInput = z.infer<typeof contactInput>;

// A name or key that matches nothing is refused, so a typo never creates or links the wrong thing.
async function findOrganization(tx: Transaction, name: string): Promise<string> {
  const [found] = await tx
    .select({ id: organizations.id })
    .from(organizations)
    .where(eq(sql`lower(${organizations.name})`, name.toLowerCase()));
  if (found === undefined) {
    const known = await tx.select({ name: organizations.name }).from(organizations);
    throw new Error(
      `Unknown organization "${name}". Known: ${known.map((row) => row.name).join(", ") || "none"}`,
    );
  }
  return found.id;
}

async function findProjects(tx: Transaction, keys: string[]): Promise<string[]> {
  if (keys.length === 0) {
    return [];
  }
  const found = await tx
    .select({ id: projects.id, key: projects.key })
    .from(projects)
    .where(inArray(projects.key, keys));
  const missing = keys.filter((key) => !found.some((row) => row.key === key));
  if (missing.length > 0) {
    const known = await tx.select({ key: projects.key }).from(projects);
    throw new Error(
      `Unknown project ${missing.join(", ")}. Known: ${known.map((row) => row.key).join(", ") || "none"}`,
    );
  }
  return found.map((row) => row.id);
}

// Registers a person who writes to the agent, or updates them: found by email, they get the name,
// the organization and the projects given. Projects are added to the ones they already had, since
// the application role cannot delete rows.
export async function saveContact(db: Database, input: ContactInput): Promise<string> {
  return db.transaction(async (tx) => {
    const organizationId =
      input.organization === undefined ? undefined : await findOrganization(tx, input.organization);
    const projectIds = await findProjects(tx, input.projects);
    const [contact] = await tx
      .insert(contacts)
      .values({ email: input.email, name: input.name, organizationId })
      .onConflictDoUpdate({
        target: contacts.email,
        // Without an organization given, the one already known is kept.
        set:
          organizationId === undefined
            ? { name: input.name }
            : { name: input.name, organizationId },
      })
      .returning({ id: contacts.id });
    if (contact === undefined) {
      throw new Error("The contact was not stored");
    }
    if (projectIds.length > 0) {
      await tx
        .insert(projectContacts)
        .values(projectIds.map((projectId) => ({ projectId, contactId: contact.id })))
        .onConflictDoNothing();
    }
    return contact.id;
  });
}

// The keys of the projects the contact works on, to show what was saved.
export async function projectKeysOfContact(db: Database, contactId: string): Promise<string[]> {
  const rows = await db
    .select({ key: projects.key })
    .from(projectContacts)
    .innerJoin(projects, eq(projects.id, projectContacts.projectId))
    .where(eq(projectContacts.contactId, contactId))
    .orderBy(projects.key);
  return rows.map((row) => row.key);
}
