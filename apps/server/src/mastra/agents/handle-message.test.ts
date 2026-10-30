import {
  type Classification,
  type DuplicateJudge,
  events,
  type KnowledgeHit,
  requests,
} from "@request-agent/core";
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
import { maxAnswerRetries } from "./answer-check";
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

// No existing request repeats the message, unless a test says otherwise.
const noDuplicate = () => Promise.resolve({ reference: null, confidence: 1 });

async function run(
  steps: ScriptedStep[],
  sender: string,
  options: {
    trust?: "VERIFIED" | "UNVERIFIED";
    classification?: Partial<Classification>;
    judgeDuplicate?: DuplicateJudge;
    text?: string;
    thread?: string;
    articles?: KnowledgeHit[];
  } = {},
) {
  const model = scriptedModel(steps);
  const searches: { actor: string; question: string }[] = [];
  const messageId = await storeMessage(getDatabase(), {
    sender,
    bodyText: options.text ?? "Le portail ne répond plus.",
    thread: options.thread,
  });
  const result = await handleMessage(
    createRequestAgent(model),
    getAppDatabase(),
    { messageId, trust: options.trust ?? "VERIFIED", channelAddress: null },
    {
      classify: fixedClassifier(options.classification),
      judgeDuplicate: options.judgeDuplicate ?? noDuplicate,
      reviewThreshold: testReviewThreshold,
      searchKnowledge: (actor, question) => {
        searches.push({ actor: actor.kind, question });
        return Promise.resolve(options.articles ?? []);
      },
    },
  );
  return { model, result, messageId, searches };
}

describe("handleMessage", () => {
  it("files the message of a verified contact as a request, and sends the answer of the model", async () => {
    const answer =
      "Votre demande est enregistrée sous la référence REQ-0001 : Portail inaccessible.";
    const { model, result } = await run(
      [{ toolCalls: [{ tool: "create_request", input: {} }] }, { text: answer }],
      bruno,
    );

    expect(result).toEqual({ reply: answer, filedBySystem: false });
    expect(model.doGenerateCalls).toHaveLength(2);
    const [request] = await getDatabase().select().from(requests);
    expect(request).toMatchObject({
      title: "Portail inaccessible",
      type: "BUG",
      needsReview: false,
    });
  });

  it("adds a message that repeats an open request to it, instead of filing a second request", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }], bruno);
    const candidates: unknown[] = [];
    const sameProblem: DuplicateJudge = (input) => {
      candidates.push(input.candidates);
      return Promise.resolve({ reference: "REQ-0001", confidence: 0.92 });
    };

    const { result } = await run(
      [
        { toolCalls: [{ tool: "create_request", input: {} }] },
        { text: "Votre message a été ajouté à la demande REQ-0001, ouverte pour ce problème." },
      ],
      bruno,
      { judgeDuplicate: sameProblem },
    );

    expect(result.reply).toBe(
      "Votre message a été ajouté à la demande REQ-0001, ouverte pour ce problème.",
    );
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
    expect(candidates).toEqual([[expect.objectContaining({ reference: "REQ-0001" })]]);
  });

  it("gives the model the information computed by the system and the wrapped message", async () => {
    const { model } = await run([{ text: "Bonjour" }], bruno);

    const prompt = model.doGenerateCalls[0]?.prompt ?? [];
    const system = prompt
      .filter((message) => message.role === "system")
      .map((message) => message.content)
      .join("\n");
    expect(system).toContain("Information computed by the system");
    expect(system).toContain('"key": "PORTAL"');
    expect(system).toContain('"confidence": 0.9');
    expect(JSON.stringify(prompt)).toContain("<message>\\nLe portail ne répond plus.\\n</message>");
  });

  it("gives the model the results of the tools in plain words, without the codes", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }], bruno);

    const { model } = await run(
      [
        { toolCalls: [{ tool: "get_request_status", input: { reference: "REQ-0001" } }] },
        { text: "Elle est nouvelle." },
      ],
      bruno,
      { classification: { type: "STATUS_REQUEST" } },
    );

    const toolResults = JSON.stringify(model.doGenerateCalls[1]?.prompt.at(-1));
    expect(toolResults).toContain("new: no one of the team has started on it yet");
    expect(toolResults).not.toContain('"NEW"');
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
      "forward_to_team",
      "get_request_status",
      "identify_contact",
      "identify_project",
      "list_my_requests",
      "list_project_requests",
      "request_clarification",
      "search_knowledge_base",
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

  it("never sends an answer naming a request no tool returned, and files a message left unhandled", async () => {
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

  it("answers a follow-up with the answer of the model, after looking up the request", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }], bruno);
    const answer =
      "La demande REQ-0001, Portail inaccessible, est nouvelle : personne de l'équipe ne l'a encore prise en charge.";

    const { result } = await run(
      [
        { toolCalls: [{ tool: "add_message_to_request", input: { reference: "REQ-0001" } }] },
        { toolCalls: [{ tool: "get_request_status", input: { reference: "REQ-0001" } }] },
        { text: answer },
      ],
      bruno,
      { classification: { type: "STATUS_REQUEST" }, text: "Où en êtes-vous ?" },
    );

    expect(result).toEqual({ reply: answer, filedBySystem: false });
  });

  it("sends only the final answer, not the text the model wrote next to its tool calls", async () => {
    const answer = "Votre demande est enregistrée sous la référence REQ-0001.";

    const { result } = await run(
      [
        {
          text: "Je crée la demande, statut NEW.",
          toolCalls: [{ tool: "create_request", input: {} }],
        },
        { text: answer },
      ],
      bruno,
    );

    expect(result.reply).toBe(answer);
  });

  it("falls back to the answer written by code when no answer of the model can be sent", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }], bruno);

    const { model, result } = await run(
      [
        { toolCalls: [{ tool: "get_request_status", input: { reference: "REQ-0001" } }] },
        { toolCalls: [{ tool: "add_message_to_request", input: { reference: "REQ-0001" } }] },
        { text: "Vous serez informé dès qu'elle avance." },
      ],
      bruno,
      { classification: { type: "STATUS_REQUEST" } },
    );

    expect(model.doGenerateCalls).toHaveLength(3 + maxAnswerRetries);
    expect(result.reply).toBe(
      "Votre message a été ajouté à la demande REQ-0001. La demande REQ-0001 est enregistrée, en attente de traitement.",
    );
  });

  it("adds a follow-up that the model answered without filing to the request of its conversation", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }], bruno, {
      thread: "thread-portal",
    });
    const answer = "La demande REQ-0001, Portail inaccessible, est nouvelle.";

    const { result, messageId } = await run([{ text: answer }], bruno, {
      classification: { type: "STATUS_REQUEST" },
      text: "Où en êtes-vous ?",
      thread: "thread-portal",
    });

    expect(result).toEqual({ reply: answer, filedBySystem: false });
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
    const history = await getDatabase().select().from(events);
    expect(
      history.filter((event) => event.messageId === messageId).map((event) => event.type),
    ).toEqual(["MESSAGE_ADDED"]);
  });

  it("files no request for a question about requests that got its answer", async () => {
    const answer = "Vous n'avez aucune demande en cours.";

    const { result } = await run(
      [{ toolCalls: [{ tool: "list_my_requests", input: {} }] }, { text: answer }],
      bruno,
      { classification: { type: "STATUS_REQUEST" }, text: "Quelles demandes ai-je en cours ?" },
    );

    expect(result).toEqual({ reply: answer, filedBySystem: false });
    expect(await getDatabase().select().from(requests)).toHaveLength(0);
  });

  it("files a new request that the model only looked up, instead of leaving it unfiled", async () => {
    const { result } = await run(
      [
        { toolCalls: [{ tool: "search_requests", input: { query: "portail" } }] },
        { text: "Aucune demande ne correspond." },
      ],
      bruno,
    );

    expect(result.filedBySystem).toBe(true);
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
  });

  it("answers a question that is not a request, and passes it to the team", async () => {
    const question = "L'équipe travaille-t-elle le samedi ?";
    const answer = "Je n'ai pas cette information : votre question est transmise à l'équipe.";

    const { result } = await run(
      [{ toolCalls: [{ tool: "forward_to_team", input: { question } }] }, { text: answer }],
      bruno,
      { classification: { type: "OTHER", confidence: 0.95 }, text: "Travaillez-vous le samedi ?" },
    );

    expect(result).toEqual({ reply: answer, filedBySystem: false });
    const [request] = await getDatabase().select().from(requests);
    expect(request).toMatchObject({ type: "OTHER", needsReview: true });
  });

  it("passes a question to the team itself when the model gives no answer that can be sent", async () => {
    const { result } = await run([{ text: "Nous allons voir cela." }], bruno, {
      classification: { type: "OTHER", confidence: 0.95 },
      text: "Travaillez-vous le samedi ?",
    });

    expect(result).toEqual({
      reply:
        "Votre question est transmise à l'équipe. Elle concerne la demande REQ-0001 (Portail inaccessible), enregistrée, en attente de traitement.",
      filedBySystem: false,
    });
    const history = await getDatabase().select().from(events);
    expect(history.filter((event) => event.type === "REVIEW_REQUESTED")).toHaveLength(1);
  });

  it("passes a follow-up question that got no answer to the request of its conversation", async () => {
    await run([{ toolCalls: [{ tool: "create_request", input: {} }] }], bruno, {
      thread: "thread-portal",
    });

    const { result } = await run([{ text: "Ils vous diront bientôt." }], bruno, {
      classification: { type: "FOLLOW_UP" },
      text: "C'est prévu pour quand ?",
      thread: "thread-portal",
    });

    expect(result.reply).toBe(
      "Votre question est transmise à l'équipe. Elle concerne la demande REQ-0001 (Portail inaccessible), enregistrée, en attente de traitement.",
    );
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
  });

  it("sends the answer as plain text, and adds the reference of a message the system filed", async () => {
    const { result } = await run([{ text: "**Bien reçu**, nous regardons." }], bruno);

    expect(result).toEqual({
      reply:
        "Bien reçu, nous regardons.\n\nVotre message est enregistré sous la référence REQ-0001. Une personne de l'équipe va le traiter.",
      filedBySystem: true,
    });
  });

  it("answers a support question from a help article, without filing a request", async () => {
    const question = "Comment ajouter un utilisateur au portail ?";
    const answer =
      "Un administrateur ouvre Administration > Comptes et choisit « Inviter un compte ».";
    const { result, searches } = await run(
      [{ toolCalls: [{ tool: "search_knowledge_base", input: { question } }] }, { text: answer }],
      bruno,
      {
        text: question,
        classification: { type: "SUPPORT" },
        articles: [
          {
            project: "PORTAL",
            title: "Ajouter un utilisateur au portail",
            body: "Un administrateur ouvre Administration > Comptes, « Inviter un compte ».",
            relevance: 0.7,
          },
        ],
      },
    );

    expect(searches).toEqual([{ actor: "contact", question }]);
    expect(result).toEqual({ reply: answer, filedBySystem: false });
    expect(await getDatabase().select().from(requests)).toHaveLength(0);
  });

  it("files a support question that no help article answers", async () => {
    const question = "Comment exporter les données du portail ?";
    const { result } = await run(
      [
        { toolCalls: [{ tool: "search_knowledge_base", input: { question } }] },
        { text: "Aucun article ne répond à cette question." },
      ],
      bruno,
      { text: question, classification: { type: "SUPPORT" } },
    );

    expect(result.filedBySystem).toBe(true);
    expect(await getDatabase().select().from(requests)).toHaveLength(1);
  });

  it("writes nothing when the classification fails", async () => {
    const messageId = await storeMessage(getDatabase(), { sender: bruno, bodyText: "Panne" });

    await expect(
      handleMessage(
        createRequestAgent(scriptedModel([{ toolCalls: [{ tool: "create_request", input: {} }] }])),
        getAppDatabase(),
        { messageId, trust: "VERIFIED", channelAddress: null },
        {
          classify: () => Promise.reject(new Error("Ollama is down")),
          judgeDuplicate: noDuplicate,
          reviewThreshold: 0.8,
          searchKnowledge: () => Promise.resolve([]),
        },
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
