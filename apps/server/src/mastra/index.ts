import { Mastra } from "@mastra/core/mastra";
import { createOllama } from "ollama-ai-provider-v2";

import { loadEnv } from "../config";
import { startSlackIfConfigured } from "../slack/start";
import { createRequestAgent } from "./agents/request-agent";

const env = loadEnv();
const ollama = createOllama({ baseURL: env.OLLAMA_BASE_URL });
const requestAgent = createRequestAgent(ollama(env.OLLAMA_MODEL));

export const mastra = new Mastra({
  agents: { requestAgent },
});

// Slack connects in the background: the server answers its API even while Slack is starting.
startSlackIfConfigured(requestAgent, mastra.getLogger()).catch((error: unknown) => {
  mastra.getLogger().error("Slack could not be started", {
    error: error instanceof Error ? error.message : String(error),
  });
});
