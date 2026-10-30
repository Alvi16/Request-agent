import { z } from "zod";

import { embeddingDimensions } from "../db/schema.ts";

export interface Embedder {
  // Name of the model, stored with each vector.
  model: string;
  embed: (texts: string[], kind: "query" | "document") => Promise<number[][]>;
}

export interface OllamaEmbedderOptions {
  // Ollama API endpoint, ending with /api.
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

const responseSchema = z.object({ embeddings: z.array(z.array(z.number())) });

// Qwen3 embedding models find better matches when the question says what it is looking for, and
// the documents are left as they are (model card of Qwen/Qwen3-Embedding-0.6B).
const qwenTask =
  "Given a question from a user of a software product, retrieve the help article that answers it";

function asQuery(model: string, text: string): string {
  return model.startsWith("qwen3-embedding") ? `Instruct: ${qwenTask}\nQuery: ${text}` : text;
}

// Computes vectors with the documented /api/embed endpoint of Ollama.
export function createOllamaEmbedder(options: OllamaEmbedderOptions): Embedder {
  const send = options.fetch ?? fetch;
  return {
    model: options.model,
    embed: async (texts, kind) => {
      const response = await send(`${options.baseUrl}/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: AbortSignal.timeout(options.timeoutMs),
        body: JSON.stringify({
          model: options.model,
          input: kind === "query" ? texts.map((text) => asQuery(options.model, text)) : texts,
        }),
      });
      if (!response.ok) {
        throw new Error(`Ollama answered ${response.status}`);
      }
      const { embeddings } = responseSchema.parse(await response.json());
      if (
        embeddings.length !== texts.length ||
        embeddings.some((vector) => vector.length !== embeddingDimensions)
      ) {
        throw new Error(
          `The embedding model ${options.model} must return one vector of ${embeddingDimensions} numbers per text`,
        );
      }
      return embeddings;
    },
  };
}
