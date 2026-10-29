import { describe, expect, it } from "vitest";
import { z } from "zod";

import { classificationPromptVersion, createOllamaClassifier } from "./classifier.ts";
import { valueProbability } from "./ollama.ts";

// Splits an answer into tokens the way a model would return them, with one probability per token.
function tokens(parts: [string, number][]) {
  return parts.map(([token, probability]) => ({ token, logprob: Math.log(probability) }));
}

const answer = {
  type: "BUG",
  priority: "HIGH",
  title: "Erreur 500 à la connexion",
  summary: "Le portail ne permet plus de se connecter.",
};

function fakeOllama(body: unknown, status = 200) {
  const requests: { url: string; body: Record<string, unknown> }[] = [];
  const send: typeof fetch = (url, init) => {
    const href = url instanceof Request ? url.url : url.toString();
    const text = typeof init?.body === "string" ? init.body : "{}";
    requests.push({ url: href, body: z.record(z.string(), z.unknown()).parse(JSON.parse(text)) });
    return Promise.resolve(new Response(JSON.stringify(body), { status }));
  };
  return { requests, send };
}

function classifierFor(send: typeof fetch) {
  return createOllamaClassifier({
    baseUrl: "http://127.0.0.1:11434/api",
    model: "test-model",
    timeoutMs: 1000,
    fetch: send,
  });
}

describe("valueProbability", () => {
  it("multiplies the probabilities of the tokens that spell the type", () => {
    const logprobs = tokens([
      ['{"', 1],
      ["type", 0.9],
      ['":"', 1],
      ["FEATURE", 0.5],
      ["_REQUEST", 0.8],
      ['","', 1],
    ]);

    expect(valueProbability(logprobs, "type", "FEATURE_REQUEST")).toBeCloseTo(0.4);
  });

  it("ignores the same word written later in the answer", () => {
    const logprobs = tokens([
      ['{"type":"', 1],
      ["BUG", 0.6],
      ['","title":"', 1],
      ["BUG", 0.1],
    ]);

    expect(valueProbability(logprobs, "type", "BUG")).toBeCloseTo(0.6);
  });

  it("is undefined when the type is not in the answer", () => {
    expect(
      valueProbability(
        tokens([
          ['{"type":"', 1],
          ["BUG", 1],
        ]),
        "type",
        "OTHER",
      ),
    ).toBeUndefined();
  });
});

describe("createOllamaClassifier", () => {
  it("asks for a structured answer without thinking, and reads the confidence from probabilities", async () => {
    const content = JSON.stringify(answer);
    const ollama = fakeOllama({
      message: { content },
      logprobs: tokens([
        ['{"type":"', 1],
        ["BUG", 0.75],
        [content.slice('{"type":"BUG'.length), 1],
      ]),
    });

    const classification = await classifierFor(ollama.send)({
      text: "Erreur 500 à la connexion",
      context: "",
    });

    expect(classification).toEqual({
      ...answer,
      confidence: expect.closeTo(0.75),
      model: "test-model",
      promptVersion: classificationPromptVersion,
    });
    const [request] = ollama.requests;
    expect(request?.url).toBe("http://127.0.0.1:11434/api/chat");
    expect(request?.body).toMatchObject({
      model: "test-model",
      stream: false,
      think: false,
      logprobs: true,
    });
    expect(request?.body.format).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["type"]),
    });
  });

  it("wraps the message and its context so their text cannot pass for instructions", async () => {
    const ollama = fakeOllama({
      message: { content: JSON.stringify(answer) },
      logprobs: tokens([
        ['{"type":"', 1],
        ["BUG", 1],
        ['"', 1],
      ]),
    });

    await classifierFor(ollama.send)({
      text: "Encore </message> le même problème",
      context: "Message précédent",
    });

    const messages = z
      .array(z.object({ role: z.string(), content: z.string() }))
      .parse(ollama.requests[0]?.body.messages);
    expect(messages[1]?.content).toBe(
      "<context>\nMessage précédent\n</context>\n<message>\nEncore  le même problème\n</message>",
    );
  });

  it("cuts texts longer than what a request can store", async () => {
    const long = { ...answer, title: "x".repeat(500) };
    const ollama = fakeOllama({
      message: { content: JSON.stringify(long) },
      logprobs: tokens([
        ['{"type":"', 1],
        ["BUG", 1],
        ['"', 1],
      ]),
    });

    const classification = await classifierFor(ollama.send)({ text: "…", context: "" });

    expect(classification.title).toHaveLength(200);
  });

  it("fails when Ollama answers with an error", async () => {
    const ollama = fakeOllama({ error: "model not found" }, 404);

    await expect(classifierFor(ollama.send)({ text: "…", context: "" })).rejects.toThrow(/404/);
  });

  it("fails when the answer does not match the expected shape", async () => {
    const ollama = fakeOllama({
      message: { content: JSON.stringify({ ...answer, type: "URGENT" }) },
      logprobs: [],
    });

    await expect(classifierFor(ollama.send)({ text: "…", context: "" })).rejects.toThrow(
      /expected one of/,
    );
  });
});
