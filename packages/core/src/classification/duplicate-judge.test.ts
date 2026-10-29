import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createOllamaDuplicateJudge } from "./duplicate-judge.ts";

const candidates = [
  { reference: "REQ-0001", title: "Paiement par carte refusé", summary: "Les paiements échouent." },
  { reference: "REQ-0002", title: "Panier vidé", summary: null },
];

function fakeOllama(match: string, probability: number) {
  const requests: unknown[] = [];
  const send: typeof fetch = (_url, init) => {
    requests.push(JSON.parse(typeof init?.body === "string" ? init.body : "{}"));
    const content = JSON.stringify({ match });
    return Promise.resolve(
      new Response(
        JSON.stringify({
          message: { content },
          logprobs: [
            { token: '{"match":"', logprob: 0 },
            { token: match, logprob: Math.log(probability) },
            { token: '"}', logprob: 0 },
          ],
        }),
      ),
    );
  };
  const judge = createOllamaDuplicateJudge({
    baseUrl: "http://127.0.0.1:11434/api",
    model: "test-model",
    timeoutMs: 1000,
    fetch: send,
  });
  return { judge, requests };
}

describe("createOllamaDuplicateJudge", () => {
  it("names the candidate the model chose, with its probability", async () => {
    const { judge, requests } = fakeOllama("2", 0.9);

    const judgement = await judge({ text: "Le panier se vide.", candidates });

    expect(judgement).toEqual({ reference: "REQ-0002", confidence: expect.closeTo(0.9) });
    const body = z
      .object({
        format: z.object({
          properties: z.object({ match: z.object({ enum: z.array(z.string()) }) }),
        }),
      })
      .parse(requests[0]);
    expect(body.format.properties.match.enum).toEqual(["1", "2", "none"]);
  });

  it("answers no duplicate when the model says none", async () => {
    const { judge } = fakeOllama("none", 0.95);

    expect(await judge({ text: "Autre chose.", candidates })).toEqual({
      reference: null,
      confidence: expect.closeTo(0.95),
    });
  });

  it("does not call the model without candidates", async () => {
    const { judge, requests } = fakeOllama("1", 1);

    expect(await judge({ text: "Bonjour", candidates: [] })).toEqual({
      reference: null,
      confidence: 1,
    });
    expect(requests).toHaveLength(0);
  });

  it("rejects an answer that names no candidate", async () => {
    const { judge } = fakeOllama("7", 1);

    await expect(judge({ text: "Bonjour", candidates })).rejects.toThrow(/names no candidate/);
  });
});
