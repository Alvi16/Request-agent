import { Mastra } from "@mastra/core/mastra";
import { createOllama } from "ollama-ai-provider-v2";

import { loadEnv } from "../config";
import { createRequestAgent } from "./agents/request-agent";

const env = loadEnv();
const ollama = createOllama({ baseURL: env.OLLAMA_BASE_URL });

export const mastra = new Mastra({
  agents: {
    requestAgent: createRequestAgent(ollama(env.OLLAMA_MODEL)),
  },
});
