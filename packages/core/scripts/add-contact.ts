// Registers a person who writes to the agent, so their emails are recognized: the agent then knows
// their name, organization and projects. Run it again to update them.
// Usage: pnpm contact:add --email emma@example.com --name "Emma Petit" --organization Acme \
//   --project SHOP --project CRM
import { parseArgs } from "node:util";

import { z } from "zod";

import { contactInput, projectKeysOfContact, saveContact } from "../src/contacts/save-contact.ts";
import { connectDatabase } from "../src/db/client.ts";
import { loadAppDatabaseEnv } from "../src/env.ts";

const { values } = parseArgs({
  options: {
    email: { type: "string" },
    name: { type: "string" },
    organization: { type: "string" },
    project: { type: "string", multiple: true },
  },
});
const input = contactInput.safeParse({ ...values, projects: values.project });
if (!input.success) {
  console.error(`Invalid contact:\n${z.prettifyError(input.error)}`);
  process.exit(1);
}

const { APP_DATABASE_URL } = loadAppDatabaseEnv();
const { db, close } = connectDatabase(APP_DATABASE_URL);
try {
  const contactId = await saveContact(db, input.data);
  const projects = await projectKeysOfContact(db, contactId);
  console.info(
    `Contact ${input.data.email} saved, projects: ${projects.length === 0 ? "none" : projects.join(", ")}.`,
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await close();
}
