import type { Agent } from "@mastra/core/agent";
import {
  connectDatabase,
  createOllamaClassifier,
  createOllamaDuplicateJudge,
  createOllamaEmbedder,
  type Database,
  loadAppDatabaseEnv,
  loadClassifierEnv,
  loadKnowledgeEnv,
  searchKnowledge,
  type TurnInput,
} from "@request-agent/core";

import { type HandledMessage, handleMessage } from "./mastra/agents/handle-message";

// Longest wait for one classification. On a CPU a classification takes up to about a minute.
const classificationTimeoutMs = 300_000;

// Longest wait for the vector of a question: about 0.3 s on a CPU, more while the model loads.
const embeddingTimeoutMs = 60_000;

export interface ChannelHandler {
  db: Database;
  handle: (input: TurnInput) => Promise<HandledMessage>;
}

// What every channel adapter needs: the database, with the restricted application role, and the
// agent bound to the classifier and the knowledge base.
export function createChannelHandler(agent: Agent): ChannelHandler {
  const classifierEnv = loadClassifierEnv();
  const { db } = connectDatabase(loadAppDatabaseEnv().APP_DATABASE_URL);
  const ollama = {
    baseUrl: classifierEnv.OLLAMA_BASE_URL,
    model: classifierEnv.OLLAMA_MODEL,
    timeoutMs: classificationTimeoutMs,
  };
  const classify = createOllamaClassifier(ollama);
  const judgeDuplicate = createOllamaDuplicateJudge(ollama);
  const embedder = createOllamaEmbedder({
    baseUrl: classifierEnv.OLLAMA_BASE_URL,
    model: loadKnowledgeEnv().OLLAMA_EMBEDDING_MODEL,
    timeoutMs: embeddingTimeoutMs,
  });
  return {
    db,
    handle: (input) =>
      handleMessage(agent, db, input, {
        classify,
        judgeDuplicate,
        reviewThreshold: classifierEnv.CLASSIFICATION_REVIEW_THRESHOLD,
        searchKnowledge: (actor, question) => searchKnowledge(db, embedder, actor, question),
      }),
  };
}
