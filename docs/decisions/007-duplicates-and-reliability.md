# 007 — Duplicates, review queue and reliability

- Status: accepted
- Date: 2026-10-29

## Context

The brief asks to avoid, as much as possible, several requests for the same problem, to let a person validate what the agent is unsure of, and to follow requests over time (brief, sections 4 and 6). A message received while the model is down or the server restarts must not be lost.

## Finding duplicates

Measured with 24 fictitious messages against 84 requests per project: 8 repeated an existing request in other words, 14 were about close but different problems, such as PayPal next to card payments, and 2 were not requests.

| Option                                                         | Assessment                                                                                                                                                                                                         |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Full-text search alone                                         | The request about the same problem came first 7 times out of 8, but scores of duplicates (0.008 to 0.043) and of different problems (up to 0.035) overlap: no threshold can decide                                 |
| Trigram similarity alone (`pg_trgm`)                           | Same: "filtrer par date de création" scored 0.466 against "filtre par plusieurs villes", more than any true duplicate (at most 0.354)                                                                              |
| Embeddings with `pgvector`                                     | Would find duplicates that share no word, but needs an embedding model that is not installed. Kept for the knowledge base (P3)                                                                                     |
| **Both searches to find candidates, then the model to decide** | **Chosen.** The 5 best of each search, at most 8, contained the duplicate 7 times out of 8. Given them, the model took the right decision for all 24 messages, with a confidence read from its token probabilities |

The judge is measured again with `pnpm eval:duplicates`. The miss of the candidate search, "régler par CB" next to "paiement par carte bancaire", shares no word stem and is the main limit.

## What happens to a duplicate

The confidence of the model on the right duplicates ranged from 0.56 to 0.92. Adding a message to the wrong request would hide it from the team, while an extra review only costs a check, so:

- with a confidence of at least the review threshold (0.8), the message is added to the existing request;
- below it, a new request is filed, linked to the candidate (`duplicate_of_request_id`), and waits for a review with the reason `POSSIBLE_DUPLICATE`.

With this threshold, 3 of the 9 duplicates were added at once and 6 went to review, all linked to the right request.

Candidates are only the open requests of the identified project that the sender can reach, so the check never reveals other requests, and an unverified sender gets none.

## Review queue

Three operations of the business core serve the web interface: list the requests waiting for review with their reasons, review a request with optional corrections (type, priority, project, status), and mark a request as a duplicate, which closes it. Each one is recorded in the history as an action of a person. These operations do not check who calls them: the web interface decides who may use them.

## Reliability

| Option                                                           | Assessment                                                                                                                          |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Deduce unhandled messages from the data                          | A thanks message gets neither a request nor an answer, so it would look unhandled forever                                           |
| **A `handled_at` marker and an attempt counter on each message** | **Chosen.** Explicit, cheap, and readable after a restart. Messages stored before the change are marked as handled by the migration |

- A failed message is retried after 1 minute, then after 5 minutes. After the third failure, it is filed for a person as an `OTHER` request with no confidence, and the sender receives its reference.
- At startup, each adapter handles again the messages that were stored but not handled: Slack from the stored event, email from the original email, now kept in full with the message.
- A database that is down at startup does not stop a channel: its messages stay unhandled until the next start.

## Consequences

- A new request costs one more call to the model when its project has open requests: about 35 s on a CPU.
- Checked with the real model: an email repeating REQ-0004 in other words was added to it with no new request, and an email stored just before the server was killed was handled once after the restart.
- The retries while Ollama is down are covered by tests, not by a real run, since stopping Ollama would also stop another program using it on the development machine.

## Sources

- [PostgreSQL `pg_trgm`](https://www.postgresql.org/docs/18/pgtrgm.html) and [`unaccent`](https://www.postgresql.org/docs/18/unaccent.html)
- [PostgreSQL full-text search ranking](https://www.postgresql.org/docs/18/textsearch-controls.html)
- [Ollama chat API, `logprobs`](https://docs.ollama.com/api/chat)
