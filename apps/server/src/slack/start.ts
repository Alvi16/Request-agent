import type { Agent } from "@mastra/core/agent";
import type { IMastraLogger } from "@mastra/core/logger";
import {
  connectDatabase,
  createOllamaClassifier,
  loadAppDatabaseEnv,
  loadClassifierEnv,
} from "@request-agent/core";

import { loadSlackTokens } from "../config";
import { handleMessage } from "../mastra/agents/handle-message";
import { startSlackAdapter } from "./adapter";
import { connectSlack } from "./connect";

// Longest wait for one classification. On a CPU a classification takes up to about a minute.
const classificationTimeoutMs = 300_000;

// Connects the agent to Slack when the Slack tokens are configured. Returns false otherwise, so
// the server keeps running without Slack.
export async function startSlackIfConfigured(
  agent: Agent,
  logger: IMastraLogger,
): Promise<boolean> {
  const tokens = loadSlackTokens();
  if (tokens === undefined) {
    logger.info("Slack is not configured: set SLACK_BOT_TOKEN and SLACK_APP_TOKEN to connect it");
    return false;
  }
  const classifierEnv = loadClassifierEnv();
  const { db } = connectDatabase(loadAppDatabaseEnv().APP_DATABASE_URL);
  const classify = createOllamaClassifier({
    baseUrl: classifierEnv.OLLAMA_BASE_URL,
    model: classifierEnv.OLLAMA_MODEL,
    timeoutMs: classificationTimeoutMs,
  });
  const slack = await connectSlack(tokens);
  startSlackAdapter({
    events: slack.events,
    web: slack.web,
    db,
    botUserId: slack.botUserId,
    teamId: slack.teamId,
    handle: (input) =>
      handleMessage(agent, db, input, {
        classify,
        reviewThreshold: classifierEnv.CLASSIFICATION_REVIEW_THRESHOLD,
      }),
    logger: {
      info: (message) => {
        logger.info(message);
      },
      error: (message, error) => {
        logger.error(message, { error: error instanceof Error ? error.message : String(error) });
      },
    },
  });
  await slack.start();
  return true;
}
