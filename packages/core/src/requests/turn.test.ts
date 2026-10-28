import { beforeEach, describe, expect, it } from "vitest";

import { alice, bruno, chloeSlackId, storeMessage } from "../../test/fixtures.ts";
import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { seedDatabase } from "../db/seed.ts";
import { describeContact, describeProject } from "./queries.ts";
import { prepareTurn, type Trust } from "./turn.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

async function turnFor(
  message: Parameters<typeof storeMessage>[1],
  trust: Trust = "VERIFIED",
  channelAddress: string | null = null,
) {
  const messageId = await storeMessage(getDatabase(), message);
  return prepareTurn(getAppDatabase(), { messageId, trust, channelAddress });
}

describe("prepareTurn: who the agent acts for", () => {
  it("acts for a verified contact, with their projects", async () => {
    const turn = await turnFor({ channel: "SLACK", sender: chloeSlackId, bodyText: "Bonjour" });

    expect(turn.actor.kind).toBe("contact");
    const contact = await describeContact(getAppDatabase(), turn);
    expect(contact).toMatchObject({
      status: "known",
      name: "Chloé Durand",
      organization: "Initech",
    });
    expect(contact.status === "known" && contact.projects.map((p) => p.key)).toEqual([
      "CRM",
      "PORTAL",
      "SHOP",
    ]);
  });

  it("gives no rights to a known address that the channel could not verify", async () => {
    const turn = await turnFor({ sender: alice, bodyText: "Bonjour" }, "UNVERIFIED");

    expect(turn.actor).toEqual({ kind: "anonymous" });
    expect(await describeContact(getAppDatabase(), turn)).toEqual({ status: "unverified" });
  });

  it("gives no rights to a verified but unknown sender", async () => {
    const turn = await turnFor({ sender: "someone@unknown.example", bodyText: "Bonjour" });

    expect(turn.actor).toEqual({ kind: "anonymous" });
  });

  it("matches the email address whatever its case", async () => {
    const turn = await turnFor({ sender: "Bruno.Leroy@Globex.example", bodyText: "Bonjour" });

    expect(turn.actor.kind).toBe("contact");
  });
});

describe("prepareTurn: which project the message is about", () => {
  it("uses the only project of the contact", async () => {
    const turn = await turnFor({ sender: bruno, bodyText: "Le portail est lent." });

    expect(await describeProject(getAppDatabase(), turn)).toMatchObject({
      status: "identified",
      project: { key: "PORTAL" },
      source: "CONTACT",
    });
  });

  it("does not choose between the projects of a contact working on several", async () => {
    const turn = await turnFor({ sender: alice, bodyText: "Le bouton de validation est cassé." });

    const project = await describeProject(getAppDatabase(), turn);
    expect(project.status).toBe("ambiguous");
    expect(project.status === "ambiguous" && project.candidates.map((p) => p.key)).toEqual([
      "CRM",
      "SHOP",
    ]);
  });

  it("uses a project key written in the message, whatever its case", async () => {
    const turn = await turnFor({ sender: alice, bodyText: "Sur le shop, le panier se vide." });

    expect(await describeProject(getAppDatabase(), turn)).toMatchObject({
      status: "identified",
      project: { key: "SHOP" },
      source: "MENTION",
    });
  });

  it("ignores the key of a project the contact does not work on", async () => {
    const turn = await turnFor({ sender: alice, bodyText: "Comme sur PORTAL, la page plante." });

    expect((await describeProject(getAppDatabase(), turn)).status).toBe("ambiguous");
  });

  it("uses a channel dedicated to a project before anything else", async () => {
    const turn = await turnFor(
      { channel: "SLACK", sender: chloeSlackId, bodyText: "Le CRM est lent." },
      "VERIFIED",
      "C000000SHOP",
    );

    expect(await describeProject(getAppDatabase(), turn)).toMatchObject({
      status: "identified",
      project: { key: "SHOP" },
      source: "CHANNEL",
    });
  });

  it("identifies the project of an unverified sender only from a dedicated channel", async () => {
    const dedicated = await turnFor(
      { sender: "someone@unknown.example", bodyText: "Problème" },
      "UNVERIFIED",
      "Portal-Support@initech.example",
    );
    const other = await turnFor({ sender: alice, bodyText: "Problème sur SHOP" }, "UNVERIFIED");

    expect(await describeProject(getAppDatabase(), dedicated)).toMatchObject({
      project: { key: "PORTAL" },
    });
    expect(await describeProject(getAppDatabase(), other)).toEqual({ status: "unknown" });
  });
});
