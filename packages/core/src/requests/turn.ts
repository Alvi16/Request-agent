import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../db/client.ts";
import { contacts, messages, projectChannels, projectContacts, projects } from "../db/schema.ts";

// Set by the channel adapter: VERIFIED only when the channel proved who sent the message, such as a
// valid Slack signature or an email that passed DMARC. The language model never sets it.
export type Trust = "VERIFIED" | "UNVERIFIED";

// Who the agent acts for while it handles one message. Only a verified, known contact has rights.
export type Actor =
  { kind: "contact"; contactId: string; projectIds: string[] } | { kind: "anonymous" };

export type ProjectIdentification =
  | { status: "identified"; projectId: string; source: "CHANNEL" | "MENTION" | "CONTACT" }
  | { status: "ambiguous"; candidateIds: string[] }
  | { status: "unknown" };

// Everything the tools know about the message being handled. It is computed by code before the
// language model runs, so the model can neither choose nor change it.
export interface Turn {
  actor: Actor;
  messageId: string;
  project: ProjectIdentification;
}

export interface TurnInput {
  // The message, already stored by the channel adapter.
  messageId: string;
  trust: Trust;
  // Slack channel ID or email address the message was sent to, to recognize a dedicated channel.
  channelAddress: string | null;
}

type Channel = (typeof messages.$inferSelect)["channel"];

async function resolveActor(
  db: Database,
  channel: Channel,
  sender: string,
  trust: Trust,
): Promise<Actor> {
  if (trust !== "VERIFIED") {
    return { kind: "anonymous" };
  }
  const identity =
    channel === "SLACK"
      ? eq(contacts.slackUserId, sender)
      : eq(contacts.email, sender.toLowerCase());
  const [contact] = await db.select({ id: contacts.id }).from(contacts).where(identity);
  if (contact === undefined) {
    return { kind: "anonymous" };
  }
  const links = await db
    .select({ projectId: projectContacts.projectId })
    .from(projectContacts)
    .where(eq(projectContacts.contactId, contact.id));
  return {
    kind: "contact",
    contactId: contact.id,
    projectIds: links.map((link) => link.projectId),
  };
}

async function findDedicatedProject(
  db: Database,
  channel: Channel,
  channelAddress: string | null,
): Promise<string | undefined> {
  if (channelAddress === null) {
    return undefined;
  }
  const address = channel === "EMAIL" ? channelAddress.toLowerCase() : channelAddress;
  const [link] = await db
    .select({ projectId: projectChannels.projectId })
    .from(projectChannels)
    .where(and(eq(projectChannels.channel, channel), eq(projectChannels.externalId, address)));
  return link?.projectId;
}

// Project keys of the contact's projects written in the message, such as "SHOP" or "shop".
async function findMentionedProjects(
  db: Database,
  projectIds: string[],
  text: string,
): Promise<string[]> {
  if (projectIds.length === 0) {
    return [];
  }
  const words = new Set(text.toUpperCase().match(/[\p{L}\p{N}]+/gu));
  const rows = await db
    .select({ id: projects.id, key: projects.key })
    .from(projects)
    .where(inArray(projects.id, projectIds));
  return rows.filter((row) => words.has(row.key)).map((row) => row.id);
}

// Deterministic rules, in order of reliability. The project is never chosen at random: when several
// projects remain possible, the result is ambiguous and the agent must ask or flag the request.
async function identifyProject(
  db: Database,
  actor: Actor,
  channel: Channel,
  channelAddress: string | null,
  text: string,
): Promise<ProjectIdentification> {
  const dedicated = await findDedicatedProject(db, channel, channelAddress);
  if (dedicated !== undefined) {
    return { status: "identified", projectId: dedicated, source: "CHANNEL" };
  }
  if (actor.kind === "anonymous") {
    return { status: "unknown" };
  }
  const mentioned = await findMentionedProjects(db, actor.projectIds, text);
  const [onlyMentioned] = mentioned;
  if (mentioned.length === 1 && onlyMentioned !== undefined) {
    return { status: "identified", projectId: onlyMentioned, source: "MENTION" };
  }
  if (mentioned.length > 1) {
    return { status: "ambiguous", candidateIds: mentioned };
  }
  const [onlyProject] = actor.projectIds;
  if (actor.projectIds.length === 1 && onlyProject !== undefined) {
    return { status: "identified", projectId: onlyProject, source: "CONTACT" };
  }
  if (actor.projectIds.length > 1) {
    return { status: "ambiguous", candidateIds: actor.projectIds };
  }
  return { status: "unknown" };
}

export async function prepareTurn(db: Database, input: TurnInput): Promise<Turn> {
  const [message] = await db
    .select({
      channel: messages.channel,
      sender: messages.sender,
      subject: messages.subject,
      bodyText: messages.bodyText,
    })
    .from(messages)
    .where(eq(messages.id, input.messageId));
  if (message === undefined) {
    throw new Error(`Message ${input.messageId} must be stored before the agent handles it`);
  }
  const actor = await resolveActor(db, message.channel, message.sender, input.trust);
  // Only a verified contact is recorded as the author, so a forged sender address claims nothing.
  if (actor.kind === "contact") {
    await db
      .update(messages)
      .set({ authorContactId: actor.contactId })
      .where(eq(messages.id, input.messageId));
  }
  const text = `${message.subject ?? ""}\n${message.bodyText}`;
  const project = await identifyProject(db, actor, message.channel, input.channelAddress, text);
  return { actor, messageId: input.messageId, project };
}

// Projects a new request of this turn may be filed under: the projects of the contact, plus the
// project of a dedicated channel, which anyone writing there is allowed to use.
export function assignableProjectIds(turn: Turn): string[] {
  const ids = new Set(turn.actor.kind === "contact" ? turn.actor.projectIds : []);
  if (turn.project.status === "identified" && turn.project.source === "CHANNEL") {
    ids.add(turn.project.projectId);
  }
  return [...ids];
}
