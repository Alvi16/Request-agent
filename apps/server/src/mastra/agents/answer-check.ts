import type { OutputProcessor } from "@mastra/core/processors";
import { parseReference, requestPriority, requestStatus, requestType } from "@request-agent/core";

// The model writes the answer to the sender, and code checks it before it is sent: a small local
// model can name a request it never looked up, promise what nobody will do, or leak the words of
// the system. A rejected answer is written again once, with the reason, and a second failure falls
// back to the answer written by code from the tool outcomes.

export interface AnswerContext {
  // Numbers of the requests the answer may name: the ones the tools returned, the facts given to
  // the model, and the message itself, which may name a request the sender cannot reach.
  knownReferences: Set<number>;
  // True when the question of the sender was really passed to the team.
  forwarded: boolean;
  // True when a request the model was told about is in progress.
  inProgress: boolean;
}

// Longest answer sent, so a model that loops on its text cannot flood a thread.
export const maxAnswerLength = 3000;

// How many times the model may write the answer again after a rejection.
export const maxAnswerRetries = 1;

// Codes of the database, which the sender must read in plain words. BUG reads the same in both.
const enumCodes = [
  ...requestStatus.enumValues,
  ...requestPriority.enumValues,
  ...requestType.enumValues.filter((code) => code !== "BUG"),
];
const internalWords = [
  new RegExp(`\\b(${enumCodes.join("|")})\\b`),
  /\b[a-z]+(_[a-z]+)+\b/,
  /\bJSON\b/,
  /<\/?(message|context|think)\b/i,
  /\bthe facts\b/i,
  /\bles faits (fournis|calculés|donnés|dont je dispose|que je possède)\b/i,
  /\bdans les faits\b/i,
  // A code written in lower case, such as "statut : new".
  new RegExp(
    `\\b(statut|status|priorité|priority)\\s*:?\\s*["'«“]?\\s*(${enumCodes.join("|")})\\b`,
    "i",
  ),
];

// Commitments that no part of the system keeps: nobody is notified when a request moves, and no
// one is bound to answer by a date.
const promises = [
  /\bvous serez (tenue?s? )?(informée?s?|prévenue?s?|notifiée?s?|contactée?s?|recontactée?s?)/i,
  /\bnous (allons|vous tiendrons|reviendrons|vous recontacterons|vous informerons|vous préviendrons)\b/i,
  /\bje vais\b/i,
  /\bje (vous )?(tiendrai|recontacterai|informerai|préviendrai|reviendrai)\b/i,
  /\bl'équipe (vous )?(répondra|reviendra|contactera|recontactera|informera)\b/i,
  /\b(sera|seront) (corrigée?s?|résolue?s?|traitée?s?|livrée?s?) (d'ici|avant|demain|sous|dans|rapidement|bientôt)\b/i,
  /\byou will be (notified|informed|contacted|updated)\b/i,
  /\b(we|I) will\b/i,
  /\b(we|I)'ll\b/i,
  /\bthe team will\b/i,
  // Anything the team or the agent "will" do, in the future tense: "ils examineront", "l'équipe
  // technique répondra".
  /(?<!\p{L})(l'équipe(\s+\p{L}+)?|ils|elles|nous|on|qui|celle-ci|celui-ci|ceux-ci)\s+(vous\s+|te\s+|t'|lui\s+|leur\s+|la\s+|le\s+|les\s+)?\p{L}+(ra|ront|rons)\b/iu,
  // The same in the near future: "l'équipe technique va examiner", "ils vont corriger".
  /(?<!\p{L})(l'équipe(\s+\p{L}+)?|ils|elles|on|celle-ci|celui-ci|ceux-ci)\s+(va|vont)\s+(vous\s+|lui\s+|leur\s+|la\s+|le\s+|les\s+)?\p{L}+(er|ir|re)\b/iu,
  // What the sender will be told, whoever tells it: "et vous tiendra informé".
  /\bvous (tiendr|informer|préviendr|recontacter|contacter|répondr)(a|ont)\b/iu,
  // A change announced as certain: "la priorité sera mise à jour".
  /\b(sera|seront)\s+(\p{L}+\s+)?(mise?s?|modifiée?s?|changée?s?|fermée?s?|clôturée?s?|corrigée?s?|résolue?s?|traitée?s?|examinée?s?)\b/iu,
];

const forwardClaims = [
  /\b(transmise?s?|transmets|transmettons|transférée?s?|relayée?s?)\b/i,
  /\b(passée?s?|signalée?s?) à l'équipe\b/i,
  /\bje (passe|transmets)\b/i,
  /\b(forwarded|passed (it |this |your [a-z]+ )?(on )?to the team)\b/i,
];

// The sender is always addressed formally, with "vous". Letters with accents are letters too, so
// "requête" does not hold the word "te".
const informalAddress = /(?<!\p{L})(tu|te|ta|ton|tes|toi)(?!\p{L})|(?<!\p{L})t'/iu;

// The system does not know how a sender wants to be addressed, so no title is used.
const courtesyTitle = /(?<!\p{L})(Madame|Monsieur|Mademoiselle|Mme|Mlle)(?!\p{L})|(?<!\p{L})M\.\s/u;

// A new request is often described as "en cours", which the sender reads as handled.
const inProgressClaim =
  /\ben cours de traitement\b|\b(est|sont) (toujours )?en cours\b|\bin progress\b/i;

function unknownReferences(text: string, known: Set<number>): string[] {
  return Array.from(text.matchAll(/REQ-\d{1,9}/gi), (match) => match[0].toUpperCase()).filter(
    (reference) => {
      const requestNumber = parseReference(reference);
      return requestNumber === undefined || !known.has(requestNumber);
    },
  );
}

// Why the answer cannot be sent, as feedback the model can act on. Empty when it can be sent.
export function answerProblems(text: string, context: AnswerContext): string[] {
  // Models write the typographic apostrophe as well: "l’équipe" is checked as "l'équipe".
  const answer = text.trim().replaceAll("’", "'");
  if (answer === "") {
    return ["The answer is empty. Write the answer to the sender."];
  }
  const problems: string[] = [];
  if (answer.length > maxAnswerLength) {
    problems.push(`The answer is longer than ${maxAnswerLength} characters. Make it shorter.`);
  }
  const unknown = unknownReferences(answer, context.knownReferences);
  if (unknown.length > 0) {
    problems.push(
      `It names ${[...new Set(unknown)].join(", ")}, which no tool returned. Only name requests the tools returned.`,
    );
  }
  const internal = internalWords
    .map((pattern) => pattern.exec(answer)?.[0])
    .filter((word) => word !== undefined);
  if (internal.length > 0) {
    problems.push(
      `It uses words of the system: ${internal.join(", ")}. Write in plain words, without codes or tool names.`,
    );
  }
  const promised = promises
    .map((pattern) => pattern.exec(answer)?.[0])
    .filter((p) => p !== undefined);
  if (promised.length > 0) {
    problems.push(
      `It promises something the system does not do: "${promised.join('", "')}". Only state facts.`,
    );
  }
  if (informalAddress.test(answer)) {
    problems.push('It says "tu" to the sender. Address the sender with "vous".');
  }
  if (!context.inProgress && inProgressClaim.test(answer)) {
    problems.push(
      "It says a request is being handled, but no request the tools returned is in progress. Give the status the tools gave.",
    );
  }
  if (courtesyTitle.test(answer)) {
    problems.push("It uses a title such as Madame or Monsieur. Use no title for the sender.");
  }
  if (!context.forwarded && forwardClaims.some((pattern) => pattern.test(answer))) {
    problems.push(
      "It says the question is passed to the team, but forward_to_team was not called. Call it, or do not say so.",
    );
  }
  return problems;
}

// Emails and Slack threads show the answer as plain text, so Markdown marks are removed.
export function toPlainText(text: string): string {
  return text
    .replaceAll(/\*\*(.+?)\*\*/g, "$1")
    .replaceAll(/__(.+?)__/g, "$1")
    .replaceAll(/`([^`]+)`/g, "$1")
    .replaceAll(/^#{1,6}\s+/gm, "")
    .trim();
}

// Checks each final answer of the model, before it ends the run. A rejected answer is sent back to
// the model with its problems, as many times as maxAnswerRetries allows.
export function createAnswerCheck(context: () => AnswerContext): OutputProcessor {
  return {
    id: "answer-check",
    processOutputStep: ({ text, toolCalls, abort, messageList }) => {
      if ((toolCalls?.length ?? 0) > 0) {
        return messageList;
      }
      const problems = answerProblems(text ?? "", context());
      if (problems.length > 0) {
        abort(`Your answer cannot be sent. ${problems.join(" ")}`, { retry: true });
      }
      return messageList;
    },
  };
}
