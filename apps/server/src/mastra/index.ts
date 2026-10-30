import { Mastra } from "@mastra/core/mastra";
import { createOllama } from "ollama-ai-provider-v2";

import { type ChannelHandler, createChannelHandler } from "../channel-handler";
import { loadEnv } from "../config";
import { startEmailIfConfigured } from "../email/start";
import { startSlackIfConfigured } from "../slack/start";
import { startWidgetIfConfigured, widgetRoutes } from "../widget/start";
import { createRequestAgent } from "./agents/request-agent";

const env = loadEnv();
const ollama = createOllama({ baseURL: env.OLLAMA_BASE_URL });
const requestAgent = createRequestAgent(ollama(env.OLLAMA_MODEL));

export const mastra = new Mastra({
  agents: { requestAgent },
  server: { apiRoutes: widgetRoutes() },
});

const logger = mastra.getLogger();

// One database pool and one classifier for every channel, created only when a channel needs them.
let channelHandler: ChannelHandler | undefined;
const handler = () => {
  channelHandler ??= createChannelHandler(requestAgent);
  return channelHandler;
};

// Channels connect in the background: the server answers its API even while they are starting.
for (const [name, start] of [
  ["Slack", startSlackIfConfigured],
  ["Email", startEmailIfConfigured],
  ["Widget", startWidgetIfConfigured],
] as const) {
  start(handler, logger).catch((error: unknown) => {
    logger.error(`${name} could not be started`, {
      error: error instanceof Error ? error.message : String(error),
    });
  });
}
