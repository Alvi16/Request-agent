import { sql } from "drizzle-orm";

import type { DuplicateCandidate, DuplicateJudge } from "../classification/duplicate-judge.ts";
import type { Database } from "../db/client.ts";
import { requests } from "../db/schema.ts";
import { visibleRequests } from "./access.ts";
import { type ClassifiedTurn, isNotARequest } from "./classified-turn.ts";
import { formatReference } from "./reference.ts";

// Requests compared with the message: the best ones by words, and the best ones by spelling, which
// catches variants that share no word stem. Measured with 84 requests per project, the request about
// the same problem was among them 7 times out of 8. See docs/agent.md.
const perMethod = 5;
export const maxDuplicateCandidates = 8;

// Open requests of the message's project that the sender can reach, most similar first. Without an
// identified project there is nothing to compare with, and an unverified sender reaches nothing,
// so the existence of other requests is never revealed.
export async function findDuplicateCandidates(
  db: Database,
  turn: ClassifiedTurn,
): Promise<DuplicateCandidate[]> {
  if (turn.project.status !== "identified") {
    return [];
  }
  const text = `${turn.classification.title}\n${turn.classification.summary}\n${turn.messageText}`;
  const words = sql`replace(plainto_tsquery('french', ${text})::text, '&', '|')::tsquery`;
  const content = sql`${requests.title} || ' ' || coalesce(${requests.summary}, '')`;
  const result = await db.execute<{ number: number; title: string; summary: string | null }>(sql`
    with open_requests as (
      select ${requests.id} as id, ${requests.number} as number, ${requests.title} as title,
             ${requests.summary} as summary,
             ts_rank(${requests.search}, ${words}) as word_score,
             similarity(unaccent(lower(${content})), unaccent(lower(${text}))) as spelling_score
      from ${requests}
      where ${requests.projectId} = ${turn.project.projectId}
        and ${requests.status} in ('NEW', 'IN_PROGRESS', 'WAITING_FOR_INFO')
        and ${visibleRequests(turn.actor)}
        and not exists (
          select 1 from messages m where m.id = ${turn.messageId} and m.request_id = ${requests.id}
        )
    ),
    ranked as (
      select *, rank() over (order by word_score desc) as word_rank,
             rank() over (order by spelling_score desc) as spelling_rank
      from open_requests
    )
    select number, title, summary from ranked
    where word_rank <= ${perMethod} or spelling_rank <= ${perMethod}
    order by least(word_rank, spelling_rank), number
    limit ${maxDuplicateCandidates}
  `);
  return result.rows.map((row) => ({
    reference: formatReference(row.number),
    title: row.title,
    summary: row.summary,
  }));
}

// Types of new requests, which may repeat an existing one. A follow-up or a status request already
// refers to a request, and is attached to it by the agent.
const newRequestTypes = new Set([
  "BUG",
  "FEATURE_REQUEST",
  "CHANGE_REQUEST",
  "EVOLUTION",
  "SUPPORT",
]);

// Asks the model whether the message repeats an open request, among the candidates found by words
// and spelling. Without candidates, the model is not called.
export async function assessDuplicate(
  db: Database,
  turn: ClassifiedTurn,
  judge: DuplicateJudge,
): Promise<ClassifiedTurn> {
  if (!newRequestTypes.has(turn.classification.type) || isNotARequest(turn)) {
    return turn;
  }
  const candidates = await findDuplicateCandidates(db, turn);
  if (candidates.length === 0) {
    return turn;
  }
  const judgement = await judge({ text: turn.messageText, candidates });
  if (judgement.reference === null) {
    return turn;
  }
  return {
    ...turn,
    duplicate: { reference: judgement.reference, confidence: judgement.confidence },
  };
}
