import {
  type Database,
  fileUnhandledMessage,
  markHandled,
  maxHandlingAttempts,
  prepareTurn,
  recordFailedAttempt,
  type TurnInput,
  unclassifiedTurn,
} from "@request-agent/core";

import type { HandledMessage } from "./mastra/agents/handle-message";
import { filedForReviewReply } from "./mastra/agents/reply";

// Waits before handling a failed message again: the model may be restarting or busy.
export const defaultRetryDelaysMs = [60_000, 300_000];

export type HandlingOutcome =
  { kind: "handled"; reply: string | null } | { kind: "retry"; delayMs: number; error: unknown };

// Handles a stored message, and makes sure it ends up somewhere: handled by the agent, retried
// later, or, after the last attempt, filed for a person without classification. The message is
// marked as handled only then, so a restart in between handles it again.
export async function handleReliably(
  db: Database,
  handle: (input: TurnInput) => Promise<HandledMessage>,
  input: TurnInput,
  retryDelaysMs: number[] = defaultRetryDelaysMs,
): Promise<HandlingOutcome> {
  try {
    const handled = await handle(input);
    await markHandled(db, input.messageId);
    return { kind: "handled", reply: handled.reply };
  } catch (error) {
    const attempts = await recordFailedAttempt(db, input.messageId);
    if (attempts < maxHandlingAttempts) {
      const delayMs = retryDelaysMs[attempts - 1] ?? retryDelaysMs.at(-1) ?? 0;
      return { kind: "retry", delayMs, error };
    }
    const turn = await unclassifiedTurn(db, await prepareTurn(db, input));
    const filed = await fileUnhandledMessage(db, turn);
    await markHandled(db, input.messageId);
    return {
      kind: "handled",
      reply: filed === undefined ? null : filedForReviewReply(filed.reference),
    };
  }
}

// Runs tasks one at a time, including the retries scheduled later, and tells when all are done.
export function createSerialQueue() {
  let chain = Promise.resolve();
  const pending = new Set<Promise<void>>();
  const push = (task: () => Promise<void>) => {
    chain = chain.then(task);
  };
  return {
    push,
    later: (delayMs: number, task: () => Promise<void>) => {
      const waiting = new Promise<void>((resolve) => {
        setTimeout(() => {
          push(task);
          resolve();
        }, delayMs);
      });
      pending.add(waiting);
      void waiting.then(() => pending.delete(waiting));
    },
    idle: async () => {
      // Retries can be scheduled while waiting, so wait until none is left.
      do {
        // oxlint-disable-next-line no-await-in-loop
        await Promise.all(pending);
        // oxlint-disable-next-line no-await-in-loop
        await chain;
      } while (pending.size > 0);
    },
  };
}
