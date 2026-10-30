import type { Agent } from "@mastra/core/agent";
import {
  addMessageToRequest,
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
  forwardToTeam,
  isMessageFiled,
  isNotARequest,
  parseReference,
  prepareTurn,
  type RequestView,
  type TurnInput,
  wrapUntrusted,
} from "@request-agent/core";

import { explainForModel } from "../tools/explain";
import { createRequestTools, type ToolOutcome } from "../tools/request-tools";
import {
  type AnswerContext,
  createAnswerCheck,
  maxAnswerRetries,
  toPlainText,
} from "./answer-check";
import { composeReply, filedForReviewReply } from "./reply";

// Model calls allowed for one message, each possibly running tools: acting on the message, looking
// up what the answer needs, then writing it. It bounds the work a message can trigger: an injected
// instruction cannot make the agent loop over the tools.
export const maxAgentSteps = 8;

// The length of a question passed to the team when the system forwards the message itself.
const forwardedQuestionLength = 500;

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

// A question mark ending a sentence, as in "Où en êtes-vous ?", and not one inside a link.
function asksAQuestion(text: string): boolean {
  return /\?(\s|$)/.test(text);
}

// Information computed by code before the model runs, given to it so it does not spend a step on
// each. The codes of the database are given in plain words, like the results of the tools.
async function describeTurn(db: Database, turn: ClassifiedTurn): Promise<string> {
  const linked = await findRequest(db, turn, {});
  const { classification } = turn;
  const information = {
    today: new Date().toISOString().slice(0, 10),
    sender: await describeContact(db, turn),
    project: await describeProject(db, turn),
    classification: {
      type: classification.type,
      priority: classification.priority,
      confidence: Number(classification.confidence.toFixed(2)),
      reviewThreshold: turn.reviewThreshold,
    },
    requestLinkedToConversation: linked.ok ? explainForModel(linked.value) : null,
    // An open request the message may repeat: create_request then adds the message to it.
    possibleDuplicate: turn.duplicate,
    referencesInMessage: [...new Set(referencesIn(turn.messageText))],
  };
  return `Information computed by the system for the message to handle. It is reliable:\n${JSON.stringify(information, null, 2)}`;
}

// The requests an answer may name: those in the information given to the model, in the message,
// or returned by a tool. Tools only return requests the sender may reach.
function answerContext(
  system: string,
  messageText: string,
  outcomes: ToolOutcome[],
): AnswerContext {
  const seen = [system, messageText, JSON.stringify(outcomes.map((outcome) => outcome.result))];
  const knownReferences = new Set(
    seen
      .flatMap(referencesIn)
      .map(parseReference)
      .filter((requestNumber) => requestNumber !== undefined),
  );
  const forwarded = outcomes.some((o) => o.tool === "forward_to_team" && o.result.ok);
  return { knownReferences, forwarded };
}

// Types of a message about a request already made, which belongs with that request.
const followUpTypes = new Set<ClassifiedTurn["classification"]["type"]>([
  "FOLLOW_UP",
  "STATUS_REQUEST",
]);

// A follow-up that the agent answered without filing it is added by code to the request of its
// conversation, so that request keeps every message about it.
async function keepFollowUp(db: Database, turn: ClassifiedTurn): Promise<ToolOutcome | undefined> {
  if (!followUpTypes.has(turn.classification.type)) {
    return undefined;
  }
  const linked = await findRequest(db, turn, {});
  if (!linked.ok) {
    return undefined;
  }
  const result = await addMessageToRequest(db, turn, { reference: linked.value.request.reference });
  return { tool: "add_message_to_request", result };
}

// A question asked to the sender is the answer itself: the agent stops there.
function askedForDetails(outcomes: ToolOutcome[]): boolean {
  return outcomes.some((o) => o.tool === "request_clarification" && o.result.ok);
}

// Files a message that is still filed under no request, so none is lost: as a request for a
// person, or, for a question that is not a request and got no answer, as a question passed to the
// team.
async function fileForPerson(
  db: Database,
  turn: ClassifiedTurn,
  answer: string,
): Promise<RequestView | undefined> {
  const filed = await fileUnhandledMessage(db, turn);
  if (filed !== undefined || answer !== "" || !asksAQuestion(turn.messageText)) {
    return filed;
  }
  const forwarded = await forwardToTeam(db, turn, {
    question: turn.messageText.slice(0, forwardedQuestionLength),
  });
  return forwarded.ok ? forwarded.value : undefined;
}

function finalReply(
  answer: string,
  outcomes: ToolOutcome[],
  filedBySystem: RequestView | undefined,
): string {
  if (answer === "" || askedForDetails(outcomes)) {
    return composeReply(outcomes, filedBySystem);
  }
  return filedBySystem === undefined
    ? answer
    : `${answer}\n\n${filedForReviewReply(filedBySystem.reference)}`;
}

// Runs the agent on one stored message, with tools bound to what its verified sender may do. The
// message is classified first: if the classification fails, nothing has been written. The model
// writes the answer, which code checks before it is sent; when no answer passes the check, the
// answer is written by code from what the tools really did.
export async function handleMessage(
  agent: Agent,
  db: Database,
  input: TurnInput,
  settings: ClassificationSettings,
): Promise<HandledMessage> {
  const classified = await classifyTurn(db, await prepareTurn(db, input), settings);
  const turn = await assessDuplicate(db, classified, settings.judgeDuplicate);
  // Thanks or an advertisement needs no action: the agent is not run, which saves its calls. A
  // question gets an answer, even when it is not a request.
  if (isNotARequest(turn) && !asksAQuestion(turn.messageText)) {
    return { reply: null, filedBySystem: false };
  }
  const outcomes: ToolOutcome[] = [];
  const system = await describeTurn(db, turn);
  const result = await agent.generate(wrapUntrusted(turn.messageText), {
    system,
    toolsets: { requests: createRequestTools(db, turn, outcomes) },
    maxSteps: maxAgentSteps,
    stopWhen: () => askedForDetails(outcomes),
    outputProcessors: [createAnswerCheck(() => answerContext(system, turn.messageText, outcomes))],
    maxProcessorRetries: maxAnswerRetries,
  });

  const answer = result.finishReason === "tripwire" ? "" : toPlainText(result.text);
  let filed = await isMessageFiled(db, turn.messageId);
  if (!filed) {
    const kept = await keepFollowUp(db, turn);
    if (kept?.result.ok === true) {
      outcomes.push(kept);
      filed = true;
    }
  }
  const filedBySystem = filed ? undefined : await fileForPerson(db, turn, answer);
  return {
    reply: finalReply(answer, outcomes, filedBySystem),
    filedBySystem: filedBySystem !== undefined,
  };
}
