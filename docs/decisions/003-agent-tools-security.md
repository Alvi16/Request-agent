# 003 — How the agent tools are protected

- Status: accepted
- Date: 2026-10-28

## Context

The agent reads and changes requests through tools. Every message it handles is written by someone outside the system, and the agent reads private data and answers outside. These are the three conditions of the "lethal trifecta": once they are combined, a message that manipulates the model can make it leak data or act for its author. No known technique prevents prompt injection reliably (OWASP LLM01:2025). The design therefore does not try to stop the model from being fooled. It limits what a fooled model can obtain: **while it handles a message, the agent can read and do exactly what the verified sender of that message may read and do.** An injected instruction gains no right, and the answer only goes back to that sender.

## How a tool knows who it acts for

| Option                                                                                                                 | Assessment                                                                                                                                                                                                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tools registered on the agent, sender passed in the Mastra request context                                             | **Rejected.** Without authentication, the Mastra server lets any HTTP client run a registered tool with a request context it chooses. Tested with Mastra 1.79: `POST /api/tools/whoami/execute` with `{"requestContext":{"sender":"attacker@evil.example"}}` answered `200 {"sender":"attacker@evil.example"}` |
| The same, plus server authentication and a middleware that overwrites the sender                                       | Depends on a configuration that must never be wrong, and an authenticated client, such as the web interface, can still send a context of its choice                                                                                                                                                            |
| **Tools built for each message, with the verified sender bound in the code** (`agent.generate(message, { toolsets })`) | **Chosen.** Tested with Mastra 1.79: the model sees and calls the tools, the tool receives the bound sender, a call to a tool outside the set runs nothing, and `POST /api/tools/...` answers `404 Tool not found`                                                                                             |
| A workflow where the model only extracts fields and the code decides every action                                      | The most robust, but the brief asks that the model decide which tools to use, and Slack must let a person drive the system freely                                                                                                                                                                              |

The fixed rules of the last option are kept before the model runs: the sender and the project are identified by code, not by the model.

## Who may reach what

The access rule is applied in a single place of the business core, to every read and write (OWASP API1:2023, Broken Object Level Authorization):

- A contact reaches the requests of the projects they work on, and the requests they made. Being in the Slack workspace gives no right, since it can include external guests.
- A request the sender cannot reach answers "not found", like a request that does not exist. References such as `REQ-0042` are sequential and could otherwise be tried one by one.
- Moving a request to another project requires working on that project.
- The status of a request is only changed by a person.

PostgreSQL row-level security was considered. It would also protect a code path that forgets the rule, but it requires passing the identity to every transaction and complicates the web interface, which must see everything. Since every access goes through the same tested rule, it is not used.

## Verified and unverified senders

The channel adapter decides whether the sender is verified, never the model:

- **Slack:** the request signature (HMAC-SHA256 with the signing secret, at most five minutes old, compared in constant time), or the app token in Socket Mode.
- **Email:** `dmarc=pass` in the `Authentication-Results` header added by the receiving mail provider, recognized by its own `authserv-id`. RFC 8601 warns that the same header can be forged when it comes from elsewhere. DMARC is required because it checks that the `From` domain matches the authenticated domain.

A verified sender who is a known contact gets the nine tools, limited by the access rule. Anyone else only gets `identify_contact`, `identify_project` and `create_request`: the message is filed and waits for a human review, and nothing existing is read or changed. The details of each check are implemented with each channel.

## Limits on the model

| Measure                                                                                   | Risk addressed (OWASP LLM Top 10, 2025)       |
| ----------------------------------------------------------------------------------------- | --------------------------------------------- |
| At most 5 model calls per message (`maxSteps`)                                            | LLM10 Unbounded Consumption                   |
| Tool inputs validated with sizes and allowed values                                       | LLM10, LLM05 Improper Output Handling         |
| A message is filed only once, even when two attempts run at the same time                 | LLM06 Excessive Agency                        |
| Tools return references, titles, statuses and summaries, never the text of other messages | LLM02 Sensitive Information Disclosure, LLM01 |
| The text of the message is wrapped in `<message>` tags that it cannot close               | LLM01 Prompt Injection                        |
| Errors are business codes, without database details                                       | LLM02                                         |
| Every change is written to the request history                                            | LLM06                                         |
| The model never chooses who receives the answer                                           | LLM06                                         |

## Database rights

The application connects with the `request_agent_app` role, created by the migrations. It can read, add and update rows. It cannot delete rows, empty a table, change the schema or change the history. The owner role is only used by the migrations and the demo data. Tested on PostgreSQL 18.6 with the project schema, and checked by the tests.

## Consequences

- Channel adapters must store the message, set whether its sender is verified, and call the message handler. They never give tools to the agent themselves.
- The agent registered on the Mastra server has no tools. Mastra Studio can talk to it, but cannot run the request tools.
- The Mastra server API must require authentication before it is reachable from another machine.
- Tests cover the access rule for every operation, the tools offered to an unverified sender, input validation, the step limit, the concurrent filing of a message and the database rights.

## Sources

- [OWASP Top 10 for LLM Applications 2025](https://genai.owasp.org/llm-top-10/), in particular [LLM01 Prompt Injection](https://genai.owasp.org/llmrisk/llm01-prompt-injection/) and [LLM06 Excessive Agency](https://genai.owasp.org/llmrisk/llm062025-excessive-agency/)
- [OWASP API1:2023 Broken Object Level Authorization](https://api-security.owasp.org/editions/2023/en/0xa1-broken-object-level-authorization)
- Beurer-Kellner et al., [Design Patterns for Securing LLM Agents against Prompt Injections](https://arxiv.org/abs/2506.08837), 2025
- Simon Willison, [The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
- [Mastra custom API routes and authentication](https://mastra.ai/docs/server/custom-api-routes), [request context](https://mastra.ai/docs/server/request-context), [`Agent.generate()`](https://mastra.ai/reference/agents/generate)
- [Verifying requests from Slack](https://docs.slack.dev/authentication/verifying-requests-from-slack/)
- [RFC 8601, Message Header Field for Indicating Message Authentication Status](https://www.rfc-editor.org/rfc/rfc8601.html)
