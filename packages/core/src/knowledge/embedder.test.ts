import { describe, expect, it } from "vitest";
import { z } from "zod";

import { embeddingDimensions } from "../db/schema.ts";
import { createOllamaEmbedder } from "./embedder.ts";

const requestSchema = z.object({ model: z.string(), input: z.array(z.string()) });

function fakeOllama(vectors: number[][], status = 200) {
  const requests: { url: string; body: z.infer<typeof requestSchema> }[] = [];
  const send: typeof fetch = (url, init) => {
    const href = url instanceof Request ? url.url : url.toString();
    const text = typeof init?.body === "string" ? init.body : "{}";
    requests.push({ url: href, body: requestSchema.parse(JSON.parse(text)) });
    return Promise.resolve(new Response(JSON.stringify({ embeddings: vectors }), { status }));
  };
  return { requests, send };
}

const vector = Array.from({ length: embeddingDimensions }, () => 0.01);

function embedderFor(model: string, send: typeof fetch) {
  return createOllamaEmbedder({
    baseUrl: "http://127.0.0.1:11434/api",
    model,
    timeoutMs: 1000,
    fetch: send,
  });
}

describe("createOllamaEmbedder", () => {
  it("embeds articles as they are, and tells a Qwen3 model what a question looks for", async () => {
    const ollama = fakeOllama([vector]);
    const embedder = embedderFor("qwen3-embedding:0.6b", ollama.send);

    expect(await embedder.embed(["Factures\nLes factures sont en ligne."], "document")).toEqual([
      vector,
    ]);
    await embedder.embed(["Où sont mes factures ?"], "query");

    expect(ollama.requests[0]).toEqual({
      url: "http://127.0.0.1:11434/api/embed",
      body: { model: "qwen3-embedding:0.6b", input: ["Factures\nLes factures sont en ligne."] },
    });
    expect(ollama.requests[1]?.body.input[0]).toMatch(
      /^Instruct: .*help article.*\nQuery: Où sont mes factures \?$/,
    );
  });

  it("sends questions as they are to other models", async () => {
    const ollama = fakeOllama([vector]);

    await embedderFor("bge-m3", ollama.send).embed(["Où sont mes factures ?"], "query");

    expect(ollama.requests[0]?.body.input).toEqual(["Où sont mes factures ?"]);
  });

  it("refuses vectors of another size, which the database cannot compare", async () => {
    const embedder = embedderFor("other-model", fakeOllama([[0.1, 0.2]]).send);

    await expect(embedder.embed(["Texte"], "document")).rejects.toThrow(/1024 numbers/);
  });

  it("refuses an answer that misses a text", async () => {
    const embedder = embedderFor("qwen3-embedding:0.6b", fakeOllama([vector]).send);

    await expect(embedder.embed(["Un", "Deux"], "document")).rejects.toThrow(/one vector/);
  });

  it("reports an error of Ollama", async () => {
    const embedder = embedderFor("missing-model", fakeOllama([], 404).send);

    await expect(embedder.embed(["Texte"], "document")).rejects.toThrow("Ollama answered 404");
  });
});
