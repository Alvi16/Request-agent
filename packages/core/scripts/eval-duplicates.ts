// Measures the duplicate judge on labeled messages, each with the candidates the search found for
// it, with the real model. Usage: pnpm eval:duplicates
import { readFileSync } from "node:fs";

import { z } from "zod";

import { createOllamaDuplicateJudge } from "../src/classification/duplicate-judge.ts";
import { loadClassifierEnv } from "../src/env.ts";

const samplesSchema = z.array(
  z.object({
    text: z.string(),
    candidates: z.array(
      z.object({ reference: z.string(), title: z.string(), summary: z.string().nullable() }),
    ),
    // Candidates about the same problem as the message: none, one, or several close ones.
    sameProblem: z.array(z.string()),
  }),
);

const env = loadClassifierEnv();
const judge = createOllamaDuplicateJudge({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_MODEL,
  timeoutMs: 600_000,
});
const samples = samplesSchema.parse(
  JSON.parse(readFileSync(new URL("../eval/duplicates.json", import.meta.url), "utf8")),
);
const threshold = env.CLASSIFICATION_REVIEW_THRESHOLD;

let merged = 0;
let wrongMerges = 0;
let reviewed = 0;
let missed = 0;
const seconds: number[] = [];
for (const sample of samples) {
  const started = performance.now();
  // One message at a time, like in production, to measure the real latency.
  // oxlint-disable-next-line no-await-in-loop
  const judgement = await judge({ text: sample.text, candidates: sample.candidates });
  seconds.push((performance.now() - started) / 1000);
  const right =
    judgement.reference === null
      ? sample.sameProblem.length === 0
      : sample.sameProblem.includes(judgement.reference);
  if (judgement.reference !== null && judgement.confidence >= threshold) {
    merged += 1;
    wrongMerges += right ? 0 : 1;
  } else if (judgement.reference !== null) {
    reviewed += 1;
  }
  if (judgement.reference === null && sample.sameProblem.length > 0) {
    missed += 1;
  }
  console.info(
    `${right ? "right" : "WRONG"}  ${judgement.reference ?? "none"} (${judgement.confidence.toFixed(2)})  ${sample.text.slice(0, 60)}`,
  );
}
seconds.sort((a, b) => a - b);
const withDuplicate = samples.filter((sample) => sample.sameProblem.length > 0).length;
console.info(
  `\n${samples.length} messages, ${withDuplicate} repeating a candidate, threshold ${threshold}`,
);
console.info(`  merged: ${merged}, of which wrong: ${wrongMerges}`);
console.info(`  new request linked for review: ${reviewed}`);
console.info(`  duplicates not recognized: ${missed} of ${withDuplicate}`);
console.info(`  time per message: median ${seconds[Math.floor(seconds.length / 2)]?.toFixed(0)} s`);
