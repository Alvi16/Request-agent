import type { Agent } from "@mastra/core/agent";
import {
  assessDuplicate,
  type ClassifiedTurn,
  type Classifier,
  classifyTurn,
  type Database,
  describeContact,
  describeProject,
  type DuplicateJudge,
  fileUnhandledMessage,
  findRequest,
  isNotARequest,
  prepareTurn,
  type TurnInput,
  wrapUntrusted,
} from "@request-agent/core";

import { createRequestTools, type ToolOutcome } from "../tools/request-tools";
import { composeReply } from "./reply";

// Model calls allowed for one message, each possibly running tools. It bounds the work a message
// can trigger: an injected instruction cannot make the agent loop over the tools.
export const maxAgentSteps = 5;

// Actions that settle what happens to the message: once one succeeds, the agent stops, which saves
// the call the model would make to write an answer nobody reads.
const settlingTools = new Set<ToolOutcome["tool"]>([
  "create_request",
  "add_message_to_request",
  "request_clarification",
]);

export interface ClassificationSettings {
  classify: Classifier;
  judgeDuplicate: DuplicateJudge;
  reviewThreshold: number;
}

export interface HandledMessage {
  // The answer to send to the sender, or null when none is needed, such as for thanks.
  reply: string | null;
  // True when the agent left the message unhandled and the system filed it for a review.
  filedBySystem: boolean;
}

function referencesIn(text: string): string[] {
  return Array.from(text.matchAll(/REQ-\d{1,9}/gi), (match) => match[0].toUpperCase());
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
    // An open request the message may repeat: create_request then adds the message to it.
    possibleDuplicate: turn.duplicate,
    referencesInMessage: [...new Set(referencesIn(turn.messageText))],
  };
  return `Facts computed by the system for the message to handle. They are reliable:\n${JSON.stringify(facts, null, 2)}`;
}

function isSettled(outcomes: ToolOutcome[]): boolean {
  return outcomes.some(
    (outcome) =>
      (settlingTools.has(outcome.tool) && outcome.result.ok) ||
      (outcome.tool === "create_request" &&
        !outcome.result.ok &&
        outcome.result.error === "NOT_A_REQUEST"),
  );
}

// Runs the agent on one stored message, with tools bound to what its verified sender may do. The
// message is classified first: if the classification fails, nothing has been written.
export async function handleMessage(
  agent: Agent,
  db: Database,
  input: TurnInput,
  settings: ClassificationSettings,
): Promise<HandledMessage> {
  const classified = await classifyTurn(db, await prepareTurn(db, input), settings);
  const turn = await assessDuplicate(db, classified, settings.judgeDuplicate);
  // Thanks or an advertisement needs no action: the agent is not run, which saves its calls.
  if (isNotARequest(turn)) {
    return { reply: null, filedBySystem: false };
  }
  const outcomes: ToolOutcome[] = [];
  await agent.generate(wrapUntrusted(turn.messageText), {
    system: await describeTurn(db, turn),
    toolsets: { requests: createRequestTools(db, turn, outcomes) },
    maxSteps: maxAgentSteps,
    stopWhen: () => isSettled(outcomes),
  });

  // A message the agent neither filed nor answered is filed for a person, so none is lost.
  const answered = outcomes.some((outcome) => outcome.result.ok);
  const filedBySystem = answered ? undefined : await fileUnhandledMessage(db, turn);
  return {
    reply: composeReply(outcomes, filedBySystem),
    filedBySystem: filedBySystem !== undefined,
  };
}
