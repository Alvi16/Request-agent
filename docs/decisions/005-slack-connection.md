# 005 — Slack connection

- Status: accepted
- Date: 2026-10-28

## Context

Collaborators must be able to drive the system from Slack: create a request, add information, find it, get its status (brief, section 3). The project runs on the development machine, with no public address ([decision 002](002-runtime-and-database.md)). The agent decides which tools to call, but the answer sent to the sender is written by code, and the tools are bound to the verified sender ([decision 003](003-agent-tools-security.md)).

## How Slack reaches the server

| Option               | Assessment                                                                                                                                                                                                                                                               |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Events API over HTTP | Needs a public URL, so a tunnel on a development machine, and a signature check on every request                                                                                                                                                                         |
| **Socket Mode**      | **Chosen.** The server opens a WebSocket to Slack with an app-level token. Slack documents that events then need no signature check, since the connection is authenticated. Socket Mode apps cannot be listed in the Slack Marketplace, which this project does not need |

## Library

| Option                                                | Assessment                                                                                                                                                                                                                                  |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Mastra channels with `@chat-adapter/slack` 4.43       | Webhook by default, and the agent posts its own text, which [decision 003](003-agent-tools-security.md) and the classification stage rule out. Built on older major versions of the Slack SDKs (`@slack/web-api` 7, `@slack/socket-mode` 2) |
| `@slack/bolt` 5.1                                     | The official framework. It includes Express and OAuth for the HTTP mode, which is not used                                                                                                                                                  |
| **`@slack/socket-mode` 3.1 and `@slack/web-api` 8.2** | **Chosen.** The official building blocks Bolt is made of, MIT, released on 2026-09-30. The adapter only needs three event types and two Web API methods                                                                                     |

## Behavior

- The agent handles mentions, direct messages, and replies in threads it already follows. Other channel messages are acknowledged and ignored, without being stored.
- Each message is stored before Slack is acknowledged, and queued before the acknowledgement, so a delivered message is not lost and a failed acknowledgement cannot leave it unhandled. A repeated delivery, including a mention that Slack sends both as a mention and as a channel message, is handled once, thanks to the unique message ID in the database.
- Messages are handled one at a time, since the model runs on a CPU. A 👀 reaction tells the sender the message is being handled.
- The sender is verified, since the connection is authenticated, except for a member of another Slack organization, such as in a Slack Connect channel. Rights still come from the contact linked to the Slack member ID: an unknown user has none.
- Slack only starts when both tokens are configured, so the server runs without it otherwise.

## Consequences

- No public address, no tunnel, and no signature secret to manage.
- The bot receives every message of the channels it is invited to, but only stores those addressed to it or continuing its threads.
- The queue lives in memory: a message received while the server restarts stays stored, but is not handled again automatically.

## Sources

- [Slack Socket Mode](https://docs.slack.dev/apis/events-api/using-socket-mode/)
- [`@slack/socket-mode`](https://www.npmjs.com/package/@slack/socket-mode) and [`@slack/web-api`](https://www.npmjs.com/package/@slack/web-api)
- [Mastra Slack channel](https://mastra.ai/docs/channels)
- [Slack `app_mention` event](https://docs.slack.dev/reference/events/app_mention/) and [`message` event](https://docs.slack.dev/reference/events/message/)
