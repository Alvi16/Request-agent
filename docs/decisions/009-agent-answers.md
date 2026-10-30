# 009 — The agent writes its answers, and code checks them

- Status: accepted
- Date: 2026-10-30
- Replaces the rule of [decision 003](003-agent-tools-security.md) that the text of the model is never sent

## Context

Until now, the answer to the sender was written by code from what the tools did, such as "Votre message a été ajouté à la demande REQ-0006." A follow-up such as "Où en êtes-vous ?" got this sentence without the status, and any other question, such as "C'est prévu pour quand ?" or "Qui s'en occupe ?", got no answer. People ask about their requests in many ways, and the agent must answer what it can and say what it cannot.

## Options

| Option                                                                                                    | Assessment                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sentences written by code for a list of question kinds, the model only telling which kinds were asked     | Measured on 34 questions with `ornith:9b`: 29 kinds right, and two short questions ("C'est pour quand ?") were missed. It only answers the kinds planned in advance, so any other question gets no answer             |
| The model answers in a separate call, with all the requests the sender may see written into its prompt    | Measured on 26 questions: 20 answers right. It bypasses the Mastra agent and its tools, gives the model free access to the data instead of tools (brief, section 2), and the prompt grows with the number of requests |
| **The Mastra agent looks up what the answer needs with its tools, writes the answer, and code checks it** | **Chosen.** The model decides which tools to use, as the brief asks, and only sees what the tools return for this sender. The check blocks the mistakes measured with the other options before anything is sent       |

## How an answer is made

1. The agent acts on the message as before: it files it, adds it to a request or asks which project. Then it looks up what the answer needs, with `find_request`, `get_request_status`, `list_my_requests`, `list_project_requests` or `search_requests`.
2. The tools return the codes of the database in plain words, such as "new: no one of the team has started on it yet", so the model does not guess what `NEW` means and does not copy codes into the answer.
3. When the answer is not in the data, such as a date or the person in charge, which the system does not record, or when the sender asks the team to do something, such as closing a request, the agent calls `forward_to_team`. The question is recorded in the history of the request (`REVIEW_REQUESTED`) and the request goes to the review queue, where the team reads it.
4. Code checks the final answer of the model before it is sent, with a Mastra output processor (`processOutputStep`). A rejected answer is sent back to the model once, with the reason (`abort` with `retry: true`, `maxProcessorRetries: 1`).
5. Only the text of the last step is sent: what the model writes next to its tool calls is not an answer.
6. When no answer passes the check, the answer is written by code from what the tools did, as before. If the message asks a question, the system also passes it to the team, so that a person answers it.

## What the check refuses

| Refused                                                                       | Example measured with `ornith:9b`                                                                                          |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| A request that no tool returned and that the message did not name             | A reference made up by the model                                                                                           |
| Codes, tool names and the words of the instructions                           | "statut : new", "dans les faits que je possède", "the facts do not hold"                                                   |
| Promises that nobody keeps                                                    | "Vous serez informé", "Ils examineront la demande et procéderont à la clôture", "La priorité sera mise à jour en critique" |
| Saying the question was passed to the team when it was not                    | "Je transmets votre question" without a call to `forward_to_team`                                                          |
| Saying "tu" to the sender                                                     | "Ils te diront qui est en charge"                                                                                          |
| Calling a request "en cours" when no request is in progress                   | "Elle est toujours en cours de traitement", for a new request                                                              |
| A title such as Madame or Monsieur, which assumes how the sender is addressed | "Madame De Souza, je ne trouve pas de demande liée à votre message", in the real Gmail test                                |
| An empty answer, or one longer than 3000 characters                           |                                                                                                                            |

The rules were checked on every real answer collected during the measures: they rejected the faulty ones and none of the right ones. Word boundaries take letters with accents into account, so that "requête" does not hold the word "te".

## Rules kept by code, whatever the model does

- A follow-up (`FOLLOW_UP`, `STATUS_REQUEST`) that the model answered without adding it to its request is added by code to the request of its conversation.
- A question passed to the team goes to the request the model names, which the sender must be able to reach, or to the request of the conversation for a follow-up. A new question, such as "Comment ajouter un utilisateur ?", gets its own request.
- A message still filed under no request at the end is filed for a person, as before, unless it only asked a question (`STATUS_REQUEST` or `OTHER`) that got its answer: "Quelles demandes ai-je en cours ?" needs no request of its own. Before, a message for which the model had only looked up requests was considered handled and was never filed.
- A clarification question is sent as it is, as before.
- A question classified `OTHER`, such as "Travaillez-vous le samedi ?", is now answered. Thanks and other messages without a question still get no answer, which avoids loops of automatic replies.

## Measures

With `ornith:9b` on the development machine, CPU only:

- The first measure of the real agent, on 13 new questions, gave 6 right answers. It showed the problems fixed above: follow-ups not added to their request, questions passed to the team on a new request instead of the existing one, promises in the future tense, codes in lower case, and text written next to tool calls being sent.
- A second measure, on 8 questions after those fixes, kept every follow-up with its request and filed no request twice. Two answers were right as written: the list of the sender's requests, and "Je ne trouve pas de demande REQ-0003" for a request of another client. Four were right but with a flaw: a new request called "en cours", promises with "qui" or "celle-ci", or a bare "Votre question a été transmise à l'équipe". For the last two, the code wrote the answer. The check now rejects the flaws found, and the answer written by code gives the request and its status.
- An answer takes 2 to 8 minutes. The model reads about 12 tokens per second and writes 2 to 3. The first call of the agent reads about 2700 tokens: the instructions, the twelve tools and the information about the message. Later steps of the same message reuse what was already read and take under 1 minute each.

The model takes about 6 GB of memory. During the measures, Linux stopped it six times for lack of memory while web browsers were open on the same 16 GB machine. The demonstration needs the browsers closed, except one tab.

## Consequences

- The answers are clearer and cover any question about the requests the sender may reach. Questions about the product itself, such as how to use a screen, are passed to the team until a knowledge base exists.
- The model can still write a clumsy or approximate sentence that the check does not catch. The check blocks the mistakes that matter most: a leak of another request, a false promise, a false claim of forwarding.
- An agent run makes up to 8 calls to the model, against 5 before, so it can act, look up and answer.
- Answers take longer, since the model writes the answer after acting.

## Sources

- Mastra 1.79, output processors: `processOutputStep`, `abort(reason, { retry: true })` and `maxProcessorRetries`, in `@mastra/core/dist/processors/index.d.ts` and `agent/trip-wire.d.ts`. Behavior checked with a test: a rejected answer is sent back with the reason, and the run ends with `finishReason: "tripwire"` once the retries are used
- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/): LLM05 Improper Output Handling, LLM06 Excessive Agency, LLM09 Misinformation
- [Mastra `Agent.generate()`](https://mastra.ai/reference/agents/generate)
