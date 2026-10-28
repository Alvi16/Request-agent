import type { Agent } from "@mastra/core/agent";
import {
  type ClassifiedTurn,
  type Classifier,
  classifyTurn,
  type Database,
  describeContact,
  describeProject,
  findRequest,
  prepareTurn,
  type TurnInput,
  wrapUntrusted,
} from "@request-agent/core";

import { createRequestTools } from "../tools/request-tools";

// Model calls allowed for one message, each possibly running tools. It bounds the work a message
// can trigger: an injected instruction cannot make the agent loop over the tools.
export const maxAgentSteps = 5;

// Sent instead of the agent's answer when that answer cannot be trusted. It states nothing that
// could be false.
export const fallbackReply =
  "Votre message a bien été reçu. Une personne de l'équipe va le traiter et reviendra vers vous.";

const referencePattern = /REQ-\d{1,9}/gi;

export interface ClassificationSettings {
  classify: Classifier;
  reviewThreshold: number;
}

export interface HandledMessage {
  reply: string;
  // True when the agent's answer was replaced by the fallback reply.
  replaced: boolean;
}

function referencesIn(text: string): Set<string> {
  return new Set(Array.from(text.matchAll(referencePattern), (match) => match[0].toUpperCase()));
}

// Facts computed by code before the model runs, given to it so it does not spend a step on each.
async function describeTurn(db: Database, turn: ClassifiedTurn): Promise<string> {
  const linked = await findRequest(db, turn, {});
  const { classification } = turn;
  const facts = {
    sender: await describeContact(db, turn),
    project: await describeProject(db, turn),
    classification: {
      type: classification.type,
      priority: classification.priority,
      confidence: Number(classification.confidence.toFixed(2)),
      reviewThreshold: turn.reviewThreshold,
    },
    requestLinkedToConversation: linked.ok ? linked.value.request : null,
    referencesInMessage: [...referencesIn(turn.messageText)],
  };
  return `Facts computed by the system for the message to handle. They are reliable:\n${JSON.stringify(facts, null, 2)}`;
}

// A reply may only cite references the system gave the agent or the sender wrote: any other one was
// made up by the model.
export function checkReply(reply: string, known: string): HandledMessage {
  const allowed = referencesIn(known);
  const invented = [...referencesIn(reply)].some((reference) => !allowed.has(reference));
  if (reply.trim() === "" || invented) {
    return { reply: fallbackReply, replaced: true };
  }
  return { reply, replaced: false };
}

// Runs the agent on one stored message, with tools bound to what its verified sender may do. The
// message is classified first: if the classification fails, nothing has been written.
export async function handleMessage(
  agent: Agent,
  db: Database,
  input: TurnInput,
  settings: ClassificationSettings,
): Promise<HandledMessage> {
  const turn = await classifyTurn(db, await prepareTurn(db, input), settings);
  const facts = await describeTurn(db, turn);
  const result = await agent.generate(wrapUntrusted(turn.messageText), {
    system: facts,
    toolsets: { requests: createRequestTools(db, turn) },
    maxSteps: maxAgentSteps,
  });
  // Every result of every step, since a reference may come from an early tool call.
  const toolOutputs = JSON.stringify(result.steps.map((step) => step.toolResults));
  return checkReply(result.text, `${facts}\n${turn.messageText}\n${toolOutputs}`);
}
