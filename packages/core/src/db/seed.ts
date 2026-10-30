import { sql } from "drizzle-orm";

import type { Database } from "./client.ts";
import { contacts, organizations, projectChannels, projectContacts, projects } from "./schema.ts";

// Fictitious demo data. The .example domain is reserved for documentation (RFC 2606).
const seedOrganizations = [
  { name: "Acme", emailDomain: "acme.example" },
  { name: "Globex", emailDomain: "globex.example" },
  { name: "Initech", emailDomain: "initech.example" },
] as const;

type SeedOrganizationDomain = (typeof seedOrganizations)[number]["emailDomain"];

const seedProjects = [
  { key: "SHOP", name: "Acme online shop", organization: "acme.example" },
  { key: "CRM", name: "Acme customer relationship management", organization: "acme.example" },
  { key: "PORTAL", name: "Globex customer portal", organization: "globex.example" },
] as const;

type SeedProjectKey = (typeof seedProjects)[number]["key"];

interface SeedContact {
  email: string;
  slackUserId: string | null;
  name: string;
  role: string;
  organization: SeedOrganizationDomain;
  projects: SeedProjectKey[];
}

const seedContacts: SeedContact[] = [
  // Works on two projects: a message from this contact has an ambiguous project.
  {
    email: "alice.martin@acme.example",
    slackUserId: null,
    name: "Alice Martin",
    role: "Product owner",
    organization: "acme.example",
    projects: ["SHOP", "CRM"],
  },
  {
    email: "bruno.leroy@globex.example",
    slackUserId: null,
    name: "Bruno Leroy",
    role: "IT manager",
    organization: "globex.example",
    projects: ["PORTAL"],
  },
  {
    email: "chloe.durand@initech.example",
    slackUserId: "U000000CHLOE",
    name: "Chloé Durand",
    role: "Developer",
    organization: "initech.example",
    projects: ["SHOP", "CRM", "PORTAL"],
  },
];

const seedProjectChannels: {
  project: SeedProjectKey;
  channel: "SLACK" | "EMAIL" | "WIDGET";
  externalId: string;
}[] = [
  { project: "SHOP", channel: "SLACK", externalId: "C000000SHOP" },
  { project: "PORTAL", channel: "EMAIL", externalId: "portal-support@initech.example" },
  // The widget embedded in the portal names its project.
  { project: "PORTAL", channel: "WIDGET", externalId: "PORTAL" },
];

function knownId(ids: Map<string, string>, key: string): string {
  const id = ids.get(key);
  if (id === undefined) {
    throw new Error(`Seed data refers to an unknown key: ${key}`);
  }
  return id;
}

// Inserts the demo data, or updates it when it already exists, so running it again is safe.
export async function seedDatabase(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    const organizationRows = await tx
      .insert(organizations)
      .values([...seedOrganizations])
      .onConflictDoUpdate({ target: organizations.emailDomain, set: { name: sql`excluded.name` } })
      .returning({ id: organizations.id, emailDomain: organizations.emailDomain });
    const organizationIds = new Map(organizationRows.map((row) => [row.emailDomain ?? "", row.id]));

    const projectRows = await tx
      .insert(projects)
      .values(
        seedProjects.map((project) => ({
          key: project.key,
          name: project.name,
          organizationId: knownId(organizationIds, project.organization),
        })),
      )
      .onConflictDoUpdate({
        target: projects.key,
        set: { name: sql`excluded.name`, organizationId: sql`excluded.organization_id` },
      })
      .returning({ id: projects.id, key: projects.key });
    const projectIds = new Map(projectRows.map((row) => [row.key, row.id]));

    const contactRows = await tx
      .insert(contacts)
      .values(
        seedContacts.map((contact) => ({
          email: contact.email,
          slackUserId: contact.slackUserId,
          name: contact.name,
          role: contact.role,
          organizationId: knownId(organizationIds, contact.organization),
        })),
      )
      .onConflictDoUpdate({
        target: contacts.email,
        set: {
          slackUserId: sql`excluded.slack_user_id`,
          name: sql`excluded.name`,
          role: sql`excluded.role`,
          organizationId: sql`excluded.organization_id`,
        },
      })
      .returning({ id: contacts.id, email: contacts.email });
    const contactIds = new Map(contactRows.map((row) => [row.email ?? "", row.id]));

    await tx
      .insert(projectContacts)
      .values(
        seedContacts.flatMap((contact) =>
          contact.projects.map((key) => ({
            projectId: knownId(projectIds, key),
            contactId: knownId(contactIds, contact.email),
          })),
        ),
      )
      .onConflictDoNothing();

    await tx
      .insert(projectChannels)
      .values(
        seedProjectChannels.map((link) => ({
          projectId: knownId(projectIds, link.project),
          channel: link.channel,
          externalId: link.externalId,
        })),
      )
      .onConflictDoUpdate({
        target: [projectChannels.channel, projectChannels.externalId],
        set: { projectId: sql`excluded.project_id` },
      });
  });
}
