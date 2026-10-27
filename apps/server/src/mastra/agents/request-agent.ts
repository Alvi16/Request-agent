import { Agent } from "@mastra/core/agent";
import type { MastraModelConfig } from "@mastra/core/llm";

const instructions = `You are the request management agent of the company.
You receive messages from collaborators and clients about their projects.
Answer in the language of the message. Never invent information you do not have.`;

export function createRequestAgent(model: MastraModelConfig): Agent {
  return new Agent({
    id: "request-agent",
    name: "Request agent",
    description: "Turns incoming messages into structured requests.",
    instructions,
    model,
  });
}
