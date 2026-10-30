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

function wasForwarded(outcomes: ToolOutcome[]): boolean {
  return outcomes.some((o) => o.tool === "forward_to_team" && o.result.ok);
}

// A question that got no answer which can be sent goes to the team, so that a person answers it,
// on the request of the message, of its conversation, or a new one.
async function forwardUnanswered(
  db: Database,
  turn: ClassifiedTurn,
  outcomes: ToolOutcome[],
): Promise<void> {
  if (!asksAQuestion(turn.messageText) || askedForDetails(outcomes) || wasForwarded(outcomes)) {
    return;
  }
  const question = turn.messageText.slice(0, forwardedQuestionLength);
  outcomes.push({
    tool: "forward_to_team",
    question,
    result: await forwardToTeam(db, turn, { question }),
  });
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

// The answer is the text of the last step, which ended the run without calling a tool and which
// the answer check read. Text the model wrote next to its tool calls is not an answer: it can
// think aloud there, and it would repeat itself.
function finalAnswer(result: Awaited<ReturnType<Agent["generate"]>>): string {
  const last = result.steps.at(-1);
  if (result.finishReason === "tripwire" || last === undefined || last.toolCalls.length > 0) {
    return "";
  }
  return toPlainText(last.text);
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

  const answer = finalAnswer(result);
  if (!(await isMessageFiled(db, turn.messageId))) {
    const kept = await keepFollowUp(db, turn);
    if (kept !== undefined) {
      outcomes.push(kept);
    }
  }
  if (answer === "") {
    await forwardUnanswered(db, turn, outcomes);
  }
  // A message still filed under no request is filed for a person, so none is lost.
  const filedBySystem = (await isMessageFiled(db, turn.messageId))
    ? undefined
    : await fileUnhandledMessage(db, turn);
  return {
    reply: finalReply(answer, outcomes, filedBySystem),
    filedBySystem: filedBySystem !== undefined,
  };
}
