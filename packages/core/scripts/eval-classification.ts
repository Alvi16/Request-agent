// Measures the classifier on the labeled evaluation messages, with the real model. It is slow on a
// CPU, so it is not part of the tests. Usage: pnpm eval:classification [dev|holdout]
import { readFileSync } from "node:fs";

import { z } from "zod";

import { createOllamaClassifier } from "../src/classification/classifier.ts";
import { requestType } from "../src/db/schema.ts";
import { loadClassifierEnv } from "../src/env.ts";

const sampleSchema = z.array(
  z.object({
    type: z.enum(requestType.enumValues),
    text: z.string(),
    context: z.string().optional(),
  }),
);

interface Outcome {
  expected: string;
  predicted: string;
  confidence: number;
  seconds: number;
}

// Probability that a right answer gets a higher confidence than a wrong one: 0.5 is chance.
function auroc(outcomes: Outcome[]): number | undefined {
  const right = outcomes.filter((o) => o.predicted === o.expected).map((o) => o.confidence);
  const wrong = outcomes.filter((o) => o.predicted !== o.expected).map((o) => o.confidence);
  if (right.length === 0 || wrong.length === 0) {
    return undefined;
  }
  let wins = 0;
  for (const r of right) {
    for (const w of wrong) {
      wins += r > w ? 1 : r === w ? 0.5 : 0;
    }
  }
  return wins / (right.length * wrong.length);
}

function macroF1(outcomes: Outcome[]): number {
  const scores = requestType.enumValues.map((label) => {
    const tp = outcomes.filter((o) => o.expected === label && o.predicted === label).length;
    const fp = outcomes.filter((o) => o.expected !== label && o.predicted === label).length;
    const fn = outcomes.filter((o) => o.expected === label && o.predicted !== label).length;
    return tp === 0 ? 0 : (2 * tp) / (2 * tp + fp + fn);
  });
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

const percent = (value: number) => `${Math.round(value * 100)} %`;

function report(set: string, outcomes: Outcome[], threshold: number): void {
  const right = outcomes.filter((o) => o.predicted === o.expected);
  const automatic = outcomes.filter((o) => o.confidence >= threshold);
  const automaticRight = automatic.filter((o) => o.predicted === o.expected);
  const reviewedMistakes = outcomes.filter(
    (o) => o.confidence < threshold && o.predicted !== o.expected,
  );
  const seconds = outcomes.map((o) => o.seconds).toSorted((a, b) => a - b);
  const separation = auroc(outcomes);
  console.info(`\n${set}: ${outcomes.length} messages`);
  console.info(
    `  right type: ${percent(right.length / outcomes.length)}, macro-F1 ${macroF1(outcomes).toFixed(2)}`,
  );
  console.info(
    `  confidence separates right from wrong: AUROC ${separation === undefined ? "n/a" : separation.toFixed(2)}`,
  );
  console.info(
    `  threshold ${threshold}: ${automatic.length} handled without review, ${automaticRight.length} of them right; ` +
      `${reviewedMistakes.length} of ${outcomes.length - right.length} mistakes sent to review`,
  );
  console.info(
    `  time per message: median ${seconds[Math.floor(seconds.length / 2)]?.toFixed(0)} s, max ${seconds.at(-1)?.toFixed(0)} s`,
  );
  for (const o of outcomes.filter((outcome) => outcome.predicted !== outcome.expected)) {
    console.info(
      `  mistake: ${o.expected} -> ${o.predicted} (confidence ${o.confidence.toFixed(2)})`,
    );
  }
}

const env = loadClassifierEnv();
const classify = createOllamaClassifier({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_MODEL,
  timeoutMs: 600_000,
});
const sets = process.argv.slice(2).length > 0 ? process.argv.slice(2) : ["dev", "holdout"];

for (const set of sets) {
  const samples = sampleSchema.parse(
    JSON.parse(
      readFileSync(new URL(`../eval/classification-${set}.json`, import.meta.url), "utf8"),
    ),
  );
  const outcomes: Outcome[] = [];
  for (const sample of samples) {
    const started = performance.now();
    // Messages are classified one at a time, like in production, to measure the real latency.
    // oxlint-disable-next-line no-await-in-loop
    const result = await classify({ text: sample.text, context: sample.context ?? "" });
    outcomes.push({
      expected: sample.type,
      predicted: result.type,
      confidence: result.confidence,
      seconds: (performance.now() - started) / 1000,
    });
  }
  report(set, outcomes, env.CLASSIFICATION_REVIEW_THRESHOLD);
}
