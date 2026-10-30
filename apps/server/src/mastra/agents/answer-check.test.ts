import { Agent } from "@mastra/core/agent";
import { describe, expect, it } from "vitest";

import { type ScriptedStep, scriptedModel } from "../../../test/scripted-model";
import {
  type AnswerContext,
  answerProblems,
  createAnswerCheck,
  maxAnswerLength,
  maxAnswerRetries,
  toPlainText,
} from "./answer-check";

const context: AnswerContext = { knownReferences: new Set([6]), forwarded: false };

describe("answerProblems", () => {
  it("accepts a plain answer about a request the tools returned", () => {
    expect(
      answerProblems(
        "La demande REQ-0006 est nouvelle : personne de l'équipe ne l'a encore prise en charge.",
        context,
      ),
    ).toEqual([]);
  });

  it("refuses an empty or overlong answer", () => {
    expect(answerProblems("  ", context)).toHaveLength(1);
    expect(answerProblems("a".repeat(maxAnswerLength + 1), context)).toHaveLength(1);
  });

  it("refuses a request that no tool returned, whatever its number of zeros", () => {
    expect(answerProblems("Voir REQ-6 et REQ-0042.", context)).toEqual([
      expect.stringContaining("REQ-0042"),
    ]);
  });

  it("refuses codes, tool names and the words of the instructions", () => {
    for (const answer of [
      "Elle est en statut NEW.",
      "Priorité : HIGH.",
      "J'ai appelé get_request_status.",
      "Voici le JSON.",
      "D'après les faits fournis, elle est nouvelle.",
      "Je ne trouve rien dans les faits concernant l'administration.",
      "The facts do not say.",
      "<message>",
    ]) {
      expect(answerProblems(answer, context)).toHaveLength(1);
    }
  });

  it("keeps the word bug, which reads the same for the sender", () => {
    expect(answerProblems("C'est un BUG de priorité haute.", context)).toEqual([]);
  });

  it("refuses promises that nobody keeps", () => {
    for (const answer of [
      "Vous serez informé dès qu'elle avance.",
      "Nous allons corriger cela.",
      "Je vais vérifier.",
      "L'équipe vous répondra rapidement.",
      "Elle sera corrigée d'ici demain.",
      "You will be notified.",
      "We will fix it.",
      "I'll check.",
      "The team will answer.",
    ]) {
      expect(answerProblems(answer, context)).toHaveLength(1);
    }
  });

  it("refuses to say a question was passed to the team unless it really was", () => {
    const answer = "Je n'ai pas cette information : votre question est transmise à l'équipe.";

    expect(answerProblems(answer, context)).toHaveLength(1);
    expect(answerProblems(answer, { ...context, forwarded: true })).toEqual([]);
  });
});

describe("toPlainText", () => {
  it("removes Markdown marks, keeping the text and the lists", () => {
    expect(toPlainText("## Statut\n- **REQ-0006** : `nouvelle`\n__fin__")).toBe(
      "Statut\n- REQ-0006 : nouvelle\nfin",
    );
  });
});

async function runCheckedAgent(steps: ScriptedStep[]) {
  const model = scriptedModel(steps);
  const agent = new Agent({ id: "test", name: "test", instructions: "Answer.", model });
  const result = await agent.generate("Où en êtes-vous ?", {
    outputProcessors: [createAnswerCheck(() => context)],
    maxProcessorRetries: maxAnswerRetries,
  });
  return { model, result };
}

describe("createAnswerCheck", () => {
  it("sends a rejected answer back to the model with its problems, and keeps the next one", async () => {
    const { model, result } = await runCheckedAgent([
      { text: "Vous serez informé." },
      { text: "La demande REQ-0006 est nouvelle." },
    ]);

    expect(result.text).toBe("La demande REQ-0006 est nouvelle.");
    expect(JSON.stringify(model.doGenerateCalls[1]?.prompt)).toContain(
      "It promises something the system does not do",
    );
  });

  it("ends without an answer when the model keeps writing answers that cannot be sent", async () => {
    const { model, result } = await runCheckedAgent([{ text: "Vous serez informé." }]);

    expect(model.doGenerateCalls).toHaveLength(1 + maxAnswerRetries);
    expect(result.text).toBe("");
    expect(result.tripwire?.processorId).toBe("answer-check");
  });
});
