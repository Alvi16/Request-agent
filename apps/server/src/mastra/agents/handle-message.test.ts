import { type Classification, events, requests } from "@request-agent/core";
import {
  alice,
  bruno,
  classified,
  seedDatabase,
  storeMessage,
  testReviewThreshold,
  useAppTestDatabase,
  useTestDatabase,
} from "@request-agent/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { offeredTools, type ScriptedStep, scriptedModel } from "../../../test/scripted-model";
import { handleMessage, maxAgentSteps } from "./handle-message";
import { createRequestAgent } from "./request-agent";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

// The classifier is replaced by a fixed answer: its own tests cover the call to the model.
function fixedClassifier(classification: Partial<Classification> = {}) {
  const base = classified(
    { actor: { kind: "anonymous" }, messageId: "", project: { status: "unknown" } },
    { title: "Portail inaccessible", ...classification },
  ).classification;
  return () => Promise.resolve(base);
}

async function run(
  steps: ScriptedStep[],
  sender: string,
  options: { trust?: "VERIFIED" | "UNVERIFIED"; classification?: Partial<Classification> } = {},
) {
  const model = scriptedModel(steps);
  const messageId = await storeMessage(getDatabase(), {
    sender,
    bodyText: "Le portail ne répond plus.",
  });
  const result = await handleMessage(
    createRequestAgent(model),
    getAppDatabase(),
    { messageId, trust: options.trust ?? "VERIFIED", channelAddress: null },
    { classify: fixedClassifier(options.classification), reviewThreshold: testReviewThreshold },
  );
  return { model, result, messageId };
}

describe("handleMessage", () => {
  it("files the message of a verified contact as a request, from its classification", async () => {
    const { model, result } = await run(
      [{ toolCalls: [{ tool: "create_request", input: {} }] }, { text: "Demande créée." }],
      bruno,
    );

    expect(result).toEqual({
      reply: "Votre demande est enregistrée sous la référence REQ-0001.",
      filedBySystem: false,
    });
    // Filing settles the message, so the model is not called again to write an answer.
    expect(model.doGenerateCalls).toHaveLength(1);
    const [request] = await getDatabase().select().from(requests);
    expect(request).toMatchObject({
      title: "Portail inaccessible",
      type: "BUG",
      needsReview: false,
    });
  });

  it("gives the model the facts computed by the system and the wrapped message", async () => {
    const { model } = await run([{ text: "Bonjour" }], bruno);

    const prompt = model.doGenerateCalls[0]?.prompt ?? [];
    const system = prompt
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    expect(system).toContain("Facts computed by the system");
    expect(system).toContain('"key": "PORTAL"');
    expect(system).toContain('"confidence": 0.9');
    expect(JSON.stringify(prompt)).toContain("<message>\\nLe portail ne répond plus.\\n</message>");
  });

  it("turns off the thinking mode of the model", async () => {
    const { model } = await run([{ text: "Bonjour" }], bruno);

    expect(model.doGenerateCalls[0]?.providerOptions).toMatchObject({ ollama: { think: false } });
  });

  it("gives a verified contact all the request tools", async () => {
    const { model } = await run([{ text: "Bonjour" }], bruno);

    expect(offeredTools(model)).toEqual([
      "add_message_to_request",
      "create_request",
      "find_request",
      "get_request_status",
      "identify_contact",
      "identify_project",
      "list_project_requests",
      "request_clarification",
      "search_requests",
      "update_request",
    ]);
  });

  it("gives an unverified sender only the tools to file the message", async () => {
    const { model } = await run([{ text: "Bonjour" }], alice, { trust: "UNVERIFIED" });

    expect(offeredTools(model)).toEqual(["create_request", "identify_contact", "identify_project"]);
  });

  it("keeps an unverified sender from changing a request, even through a tool it was not given", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }, { text: "ok" }], bruno);

    await run(
      [
        {
          toolCalls: [
            {
              tool: "update_request",
              input: { reference: "REQ-0001", changes: { priority: "LOW" } },
            },
          ],
        },
        { text: "ok" },
      ],
      bruno,
      { trust: "UNVERIFIED" },
    );

    const [request] = await getDatabase().select().from(requests);
    expect(request?.priority).toBe("HIGH");
    const history = await getDatabase().select().from(events);
    expect(history.filter((event) => event.type === "UPDATED")).toHaveLength(0);
  });

  it("rejects an invalid tool input without running the tool", async () => {
    const { result } = await run(
      [
        { toolCalls: [{ tool: "create_request", input: { projectKey: "not a key!" } }] },
        { text: "ok" },
      ],
      bruno,
    );

    // The tool did not run, so the system filed the message for a review instead.
    expect(result.filedBySystem).toBe(true);
  });

  it("stops after a bounded number of steps when the model keeps calling tools", async () => {
    const { model } = await run(
      [{ toolCalls: [{ tool: "get_request_status", input: { reference: "REQ-0001" } }] }],
      bruno,
    );

    expect(model.doGenerateCalls).toHaveLength(maxAgentSteps);
  });

  it("never sends the text of the model, and files a message the agent left unhandled", async () => {
    const { result } = await run(
      [{ text: "C'est noté sous REQ-0042, l'équipe s'en occupe." }],
      bruno,
    );

    expect(result).toEqual({
      reply:
        "Votre message est enregistré sous la référence REQ-0001. Une personne de l'équipe va le traiter.",
      filedBySystem: true,
    });
    const [request] = await getDatabase().select().from(requests);
    expect(request?.needsReview).toBe(true);
  });

  it("asks which project when the sender works on several, instead of guessing", async () => {
    const question = "Ce problème concerne-t-il la boutique (SHOP) ou le CRM ?";
    const { result } = await run(
      [
        { toolCalls: [{ tool: "create_request", input: {} }] },
        { toolCalls: [{ tool: "request_clarification", input: { question } }] },
        { text: "ok" },
      ],
      alice,
    );

    expect(result).toEqual({ reply: question, filedBySystem: false });
    const [request] = await getDatabase().select().from(requests);
    expect(request).toMatchObject({
      status: "WAITING_FOR_INFO",
      needsReview: true,
      projectId: null,
    });
  });

  it("does not run the agent, file or answer anything for thanks", async () => {
    const { model, result } = await run([{ text: "De rien !" }], bruno, {
      classification: { type: "OTHER", confidence: 0.95 },
    });

    // No answer, which also avoids loops of automatic replies by email.
    expect(result).toEqual({ reply: null, filedBySystem: false });
    expect(model.doGenerateCalls).toHaveLength(0);
    expect(await getDatabase().select().from(requests)).toHaveLength(0);
  });

  it("answers a status request with the status, and files the message under the request", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }], bruno);

    const { result } = await run(
      [
        { toolCalls: [{ tool: "get_request_status", input: { reference: "REQ-0001" } }] },
        { toolCalls: [{ tool: "add_message_to_request", input: { reference: "REQ-0001" } }] },
      ],
      bruno,
      { classification: { type: "STATUS_REQUEST" } },
    );

    expect(result.reply).toBe(
      "Votre message a été ajouté à la demande REQ-0001. La demande REQ-0001 est enregistrée, en attente de traitement.",
    );
  });

  it("writes nothing when the classification fails", async () => {
    const messageId = await storeMessage(getDatabase(), { sender: bruno, bodyText: "Panne" });

    await expect(
      handleMessage(
        createRequestAgent(scriptedModel([{ toolCalls: [{ tool: "create_request", input: {} }] }])),
        getAppDatabase(),
        { messageId, trust: "VERIFIED", channelAddress: null },
        { classify: () => Promise.reject(new Error("Ollama is down")), reviewThreshold: 0.8 },
      ),
    ).rejects.toThrow("Ollama is down");
    expect(await getDatabase().select().from(requests)).toHaveLength(0);
  });
});

describe("the agent registered on the server", () => {
  it("has no tools, so the server API cannot run the request tools", async () => {
    const agent = createRequestAgent(scriptedModel([{ text: "Bonjour" }]));

    expect(await agent.listTools()).toEqual({});
  });
});
