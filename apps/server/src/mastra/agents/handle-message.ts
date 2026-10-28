import type { Agent } from "@mastra/core/agent";
import { type Database, prepareTurn, type TurnInput } from "@request-agent/core";

import { createRequestTools } from "../tools/request-tools";

// Model calls allowed for one message, each possibly running tools. It bounds the work a message
// can trigger: an injected instruction cannot make the agent loop over the tools.
export const maxAgentSteps = 5;

export interface IncomingMessage extends TurnInput {
  // Text shown to the model: subject and body as received, written by the sender.
  text: string;
}

const messageTag = /<\/?message\b[^>]*>/gi;

// The sender's text is wrapped so the model can tell it apart from its instructions. Tags of the
// same name inside the text are removed until none is left, since removing one can join the
// pieces of another, so the text cannot close the wrapper early.
export function wrapUntrusted(text: string): string {
  let content = text;
  let previous;
  do {
    previous = content;
    content = content.replaceAll(messageTag, "");
  } while (content !== previous);
  return `<message>\n${content}\n</message>`;
}

// Runs the agent on one stored message, with tools bound to what its verified sender may do.
export async function handleMessage(agent: Agent, db: Database, message: IncomingMessage) {
  const turn = await prepareTurn(db, message);
  return agent.generate(wrapUntrusted(message.text), {
    toolsets: { requests: createRequestTools(db, turn) },
    maxSteps: maxAgentSteps,
  });
}
