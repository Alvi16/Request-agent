import { z } from "zod";

export interface OllamaOptions {
  // Ollama API endpoint, ending with /api.
  baseUrl: string;
  model: string;
  timeoutMs: number;
  fetch?: typeof fetch;
}

export type Logprobs = { token: string; logprob: number }[];

const responseSchema = z.object({
  message: z.object({ content: z.string() }),
  logprobs: z.array(z.object({ token: z.string(), logprob: z.number() })).default([]),
});

// Asks the model for an answer that follows a JSON schema, with the probabilities of its tokens.
// The Mastra provider for Ollama does not return them, so the documented API is called directly.
export async function askOllama(
  options: OllamaOptions,
  request: { system: string; user: string; format: unknown },
): Promise<{ content: string; logprobs: Logprobs }> {
  const send = options.fetch ?? fetch;
  const response = await send(`${options.baseUrl}/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    signal: AbortSignal.timeout(options.timeoutMs),
    body: JSON.stringify({
      model: options.model,
      stream: false,
      think: false,
      format: request.format,
      logprobs: true,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: request.system },
        { role: "user", content: request.user },
      ],
    }),
  });
  if (!response.ok) {
    throw new Error(`Ollama answered ${response.status}`);
  }
  const body = responseSchema.parse(await response.json());
  return { content: body.message.content, logprobs: body.logprobs };
}

// Probability of the tokens that spell a string value of the answer, at its first occurrence
// after its key. The value must be written between quotes, so a value that only starts another
// one does not match.
export function valueProbability(
  logprobs: Logprobs,
  key: string,
  value: string,
): number | undefined {
  let text = "";
  const spans = logprobs.map(({ token, logprob }) => {
    const start = text.length;
    text += token;
    return { start, end: text.length, logprob };
  });
  const keyAt = text.indexOf(`"${key}"`);
  const begin = keyAt === -1 ? -1 : text.indexOf(`"${value}"`, keyAt + key.length + 2);
  if (begin === -1) {
    return undefined;
  }
  const first = begin + 1;
  const last = first + value.length;
  const total = spans
    .filter((span) => span.start < last && span.end > first)
    .reduce((sum, span) => sum + span.logprob, 0);
  return Math.exp(total);
}
