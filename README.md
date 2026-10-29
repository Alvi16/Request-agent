# Request-agent

Multi-channel AI agent that centralizes requests about the company's projects. It receives messages from Slack and from a dedicated mailbox, understands them, classifies them and stores them as structured requests that can be found, followed and updated. The agent core is built with [Mastra](https://mastra.ai) and runs on a local language model through [Ollama](https://ollama.com).

## Status

The foundations, the data model, the agent tools, the classification, the Slack and Email channels, duplicate detection, the review queue and the recovery of unhandled messages are in place. The web interface comes next.

| Feature                                                       | Priority | Status      |
| ------------------------------------------------------------- | -------- | ----------- |
| Monorepo, TypeScript, lint, format and test tooling           | —        | Done        |
| Mastra agent connected to a local Ollama model                | P0       | Done        |
| Local PostgreSQL database                                     | P0       | Done        |
| Data model and structured storage with history and provenance | P0       | Done        |
| Typed tools (create, update, find, list, status, search)      | P0       | Done        |
| Classification and uncertainty handling                       | P0       | Done        |
| Slack integration                                             | P0       | Done        |
| Email integration                                             | P0       | Done        |
| Email conversations, duplicates, human validation             | P1       | Done        |
| Web interface                                                 | P1       | Not started |
| Embeddable web widget                                         | P2       | Not planned |
| Per-project knowledge base and RAG                            | P3       | Not planned |

## Architecture at a glance

```mermaid
flowchart LR
    Slack["Slack<br/>Socket Mode"] --> Handler["Message handler<br/>apps/server"]
    Email["Email<br/>IMAP and SMTP"] --> Handler
    Handler --> Classifier["Classifier<br/>packages/core"]
    Classifier --> Ollama
    Handler --> Agent[Request agent]
    Agent --> Ollama["Ollama<br/>local model"]
    Agent --> Tools["Request tools<br/>built for each message"]
    Tools --> Core["Business core<br/>packages/core"]
    Core --> Postgres[("PostgreSQL<br/>Docker")]
```

The business core holds the data model and the request operations, with no dependency on any channel. Slack and Email will be input adapters in front of the same agent: each one stores the message received, tells whether the channel verified its sender, and hands it to the message handler. The data model is described in [`docs/data-model.md`](docs/data-model.md).

Each message is first classified by a separate call to the model, which gives its type, priority, title and summary, with a confidence read from the model's token probabilities. A request waits for a human review when this confidence is low, when its project is unclear or when its sender is unverified. How a message is handled, the types and the measured quality are described in [`docs/agent.md`](docs/agent.md).

The agent works on requests only through ten typed tools: `identify_contact`, `identify_project`, `create_request`, `request_clarification`, `update_request`, `find_request`, `list_project_requests`, `get_request_status`, `add_message_to_request` and `search_requests`. Every message is written by someone outside the system, so the design assumes a message can try to manipulate the model, and limits what it can obtain:

- The tools are built for each message, bound to its sender in the code. They are not registered on the Mastra server, so its HTTP API cannot run them, and neither the model nor a client can change who they act for.
- A verified sender reaches only the requests of the projects they work on, and the requests they made. Any other request answers "not found". An unverified sender only gets the tools to file the message, which then waits for a human review.
- The project is identified by fixed rules before the model runs: a channel dedicated to a project, then a project key written in the message, then the only project of the sender. When several projects remain possible, the result is ambiguous and the model cannot pick one at random.
- The model makes at most 5 calls per message, tool inputs have bounded sizes, a message is filed only once, and every change is written to the request history.
- The answer to the sender is written by the code from what the tools did, never by the model. A message the agent leaves unhandled is filed for a review, so none is lost.
- The application connects to the database with the `request_agent_app` role, which cannot delete rows, change the schema or rewrite the history.

The reasons behind the main technical choices are recorded in [`docs/decisions/`](docs/decisions/).

## Prerequisites

| Tool    | Version | Notes                                                                                      |
| ------- | ------- | ------------------------------------------------------------------------------------------ |
| Node.js | 26.12.1 | Pinned in `.nvmrc`. Installing it with [nvm](https://github.com/nvm-sh/nvm) is recommended |
| pnpm    | 12.15.0 | Pinned in `package.json` (`packageManager`)                                                |
| Ollama  | 0.40.11 | Version tested. Older versions can refuse recent models (0.40.3 does)                      |
| Docker  | 29.1.3  | Version tested, with Docker Compose 2.40.3. Runs the database                              |

The `ornith:9b` model takes 5.6 GB and needs about 6 GB of free RAM. It runs on the CPU when no GPU is available, which makes each answer take from a few seconds to about a minute and a half.

## Installation

```bash
git clone git@github.com:Alvi16/Request-agent.git
cd Request-agent

nvm install 26.12.1
nvm use
npm install -g pnpm@12.15.0

pnpm install

ollama pull ornith:9b
```

## Configuration

One file, at the root, configures the whole project. It is created from its template and never committed:

```bash
cp .env.example .env
```

| Variable                                                                   | Role                                                                                                                | Example value                                                               |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`                                                        | Password of the `request_agent` database user, used by Docker Compose                                               | `change-me`                                                                 |
| `POSTGRES_PORT`                                                            | Port of the database on the machine (localhost only)                                                                | `5433`                                                                      |
| `DATABASE_URL`                                                             | Connection to the development database, as its owner. Used by the migrations and the demo data                      | `postgresql://request_agent:change-me@127.0.0.1:5433/request_agent`         |
| `APP_DATABASE_URL`                                                         | Connection used by the application, with the restricted `request_agent_app` role                                    | `postgresql://request_agent_app:change-me-too@127.0.0.1:5433/request_agent` |
| `TEST_DATABASE_URL`                                                        | Connection to the test database. Its name must end with `_test`                                                     | `postgresql://request_agent:change-me@127.0.0.1:5433/request_agent_test`    |
| `OLLAMA_BASE_URL`                                                          | Ollama API endpoint. Must end with `/api`                                                                           | `http://127.0.0.1:11434/api`                                                |
| `OLLAMA_MODEL`                                                             | Model used by the agent. It must be pulled first                                                                    | `ornith:9b`                                                                 |
| `CLASSIFICATION_REVIEW_THRESHOLD`                                          | Optional. Below this confidence, from 0 to 1, a request waits for a human review                                    | `0.8` (default)                                                             |
| `SLACK_BOT_TOKEN`                                                          | Optional. Bot token of the Slack app. Without the two Slack tokens, the server runs without Slack                   | `xoxb-…`                                                                    |
| `SLACK_APP_TOKEN`                                                          | Optional. App-level token with the `connections:write` scope, for Socket Mode                                       | `xapp-…`                                                                    |
| `EMAIL_IMAP_HOST`, `EMAIL_IMAP_PORT`, `EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT` | Servers of the agent's mailbox. Without `EMAIL_IMAP_HOST`, the server runs without email                            | `127.0.0.1`, `3143`, `127.0.0.1`, `3025` (local mail server)                |
| `EMAIL_USER`, `EMAIL_PASSWORD`                                             | Login and password of the mailbox. On the local mail server, the password is chosen here                            | `agent`, `change-me-mail`                                                   |
| `EMAIL_ADDRESS`                                                            | Address the agent receives and answers from                                                                         | `agent@requests.example`                                                    |
| `EMAIL_SECURE`                                                             | `true` to connect with TLS, as real mail servers require. Defaults to `true`                                        | `false` (local mail server)                                                 |
| `EMAIL_TRUSTED_AUTHSERV_ID`                                                | Optional. Name of the receiving server in its `Authentication-Results` header. Only that header can verify a sender | `mx.google.com`                                                             |
| `EMAIL_TRUST_LOCAL_SENDERS`                                                | Optional, local tests only: every sender counts as verified. Refused for a mailbox that is not on this machine      | `true`                                                                      |
| `TEST_EMAIL_USER`, `TEST_EMAIL_PASSWORD`                                   | Mailbox of the tests, on the local mail server. The tests empty it                                                  | `agent-test`, `change-me-mail-test`                                         |

Set a password of your choice, and use the same password and port in `DATABASE_URL` and `TEST_DATABASE_URL`. Docker Compose refuses to start the database without a password. This password is applied only when the database is created, at the first start: changing it later has no effect on the existing database.

Choose another password for `APP_DATABASE_URL`. `pnpm db:migrate` applies it to the `request_agent_app` role each time it runs, so it can be changed later.

The server refuses to start and names the faulty variable when one of them is missing or invalid.

## Running

Start the database and the local mail server. The command waits until they are started:

```bash
pnpm db:up
```

The database keeps its data in a Docker volume. `pnpm db:down` stops both without deleting it. The local mail server keeps emails in memory only.

Create the tables and the application role, then insert the fictitious demo data. Both commands can be run again safely:

```bash
pnpm db:migrate
pnpm db:seed
```

Ollama must be running. Start it in a separate terminal if it is not already running as a service:

```bash
ollama serve
```

Development mode, with reload on file changes:

```bash
pnpm dev
```

The API is available on `http://localhost:4111/api` and Mastra Studio, the built-in interface to test the agent, on `http://localhost:4111`.

Production build and start:

```bash
pnpm build
pnpm start
```

## Connecting Slack

The agent connects to Slack in Socket Mode: the server opens the connection, so no public address or tunnel is needed. Use a test workspace, never a company workspace with real data.

1. Create a free workspace at [slack.com/get-started](https://slack.com/get-started#/createnew).
2. At [api.slack.com/apps](https://api.slack.com/apps), select **Create New App**, then **From a manifest**, choose the workspace, and paste the content of [`apps/server/slack-app-manifest.yaml`](apps/server/slack-app-manifest.yaml).
3. In **Basic Information**, under **App-Level Tokens**, generate a token with the `connections:write` scope, and set it as `SLACK_APP_TOKEN` in `.env`.
4. In **Install App**, install the app to the workspace, and set the **Bot User OAuth Token** as `SLACK_BOT_TOKEN` in `.env`.
5. Start the server with `pnpm dev`. The log shows `Slack adapter listening`.
6. In Slack, invite the bot to a channel with `/invite @Request agent`, then mention it, or send it a direct message.

The agent handles mentions, direct messages, and replies in the threads it already takes part in. It ignores the other messages of a channel, without storing them. It adds 👀 to a message it handles, then answers in its thread, usually 2 to 4 minutes later on a CPU.

A Slack user only gets rights when a contact with their Slack member ID exists in the database (`contacts.slack_user_id`). A channel dedicated to a project is declared in `project_channels`, with the channel ID.

## Connecting email

The agent watches its mailbox over IMAP and answers over SMTP. With the values of `.env.example`, it uses the local mail server started by `pnpm db:up`, with no account to create: start the server with `pnpm dev`, and the log shows `Email adapter listening`.

Any mail client can write to the agent on the local mail server, at `127.0.0.1`, SMTP port `3025` and IMAP port `3143`. It accepts mail for any address, and creates a mailbox for each recipient, whose login and password are its address.

The agent handles each new email, keeps it with its attachments' descriptions, and answers in the same thread, with the request reference in the subject. A reply is attached to its conversation through its `In-Reply-To` and `References` headers, and the history quoted in a reply is not given to the model. Automatic emails, such as out-of-office replies, mailing lists or bounces, are kept but neither handled nor answered, and the answers of the agent are marked `Auto-Submitted: auto-replied`, so robots do not answer each other.

A sender is only verified by the `Authentication-Results` header that the receiving mail server adds, when it shows that DMARC passed for the sender's domain: set `EMAIL_TRUSTED_AUTHSERV_ID` to the name of that server. A sender can write such a header in the email itself, so any other one is ignored. The local mail server adds no such header: without `EMAIL_TRUST_LOCAL_SENDERS=true`, every sender is unverified there, and their requests wait for a review.

An address dedicated to a project, such as one forwarded to the agent's mailbox, is declared in `project_channels`.

## Usage

Send a message to the agent:

```bash
curl -X POST http://localhost:4111/api/agents/request-agent/generate \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Bonjour"}]}'
```

The JSON response contains the answer in the `text` field. This route reaches the agent without its request tools: they are only given to messages received through a channel, such as Slack.

## Tests and code quality

| Command                    | What it checks                                                                                                                                                                               |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`                | Tests (Vitest). The model is simulated, Ollama is not needed. The tests need the database and the local mail server (`pnpm db:up`) and use the separate test database, created automatically |
| `pnpm typecheck`           | TypeScript types, in strict mode                                                                                                                                                             |
| `pnpm lint`                | Lint rules with oxlint, including type-aware rules                                                                                                                                           |
| `pnpm format:check`        | Formatting with Prettier. `pnpm format` fixes it                                                                                                                                             |
| `pnpm eval:classification` | Quality of the classifier on labeled messages, with the real model. Needs Ollama and takes 30 to 60 minutes on a CPU, so it is not part of `pnpm test`                                       |
| `pnpm eval:duplicates`     | Quality of the duplicate check on labeled messages and their candidates, with the real model. Needs Ollama and takes about 15 minutes on a CPU                                               |

## Project structure

```
Request-agent/
├── apps/
│   └── server/                     Mastra server
│       ├── slack-app-manifest.yaml Settings of the Slack app
│       └── src/
│           ├── config.ts           Environment variables validation
│           ├── channel-handler.ts  Database and agent shared by the channel adapters
│           ├── reliable-handling.ts  Retries, and filing for a person after the last failure
│           ├── email/
│           │   ├── parse.ts        Reads an email: sender, thread, new text, attachments
│           │   ├── policy.ts       Verified senders and automatic emails
│           │   ├── adapter.ts      Stores, queues and answers emails
│           │   ├── connect.ts      IMAP and SMTP clients
│           │   └── start.ts        Starts email with the server when it is configured
│           ├── slack/
│           │   ├── events.ts       Which Slack events reach the agent
│           │   ├── adapter.ts      Stores, queues and answers Slack messages
│           │   ├── connect.ts      Socket Mode and Web API clients
│           │   └── start.ts        Starts Slack with the server when it is configured
│           └── mastra/
│               ├── index.ts        Mastra entry point: registers the agent
│               ├── agents/
│               │   ├── request-agent.ts   Agent and its instructions
│               │   └── handle-message.ts  Runs the agent on one message, with its tools
│               └── tools/
│                   └── request-tools.ts   The ten request tools
├── packages/
│   └── core/                       Business core, independent of any channel
│       ├── drizzle/                SQL migrations, generated from the schema
│       ├── eval/                   Labeled messages to measure the classifier
│       ├── scripts/                Migration, demo data and evaluation commands
│       ├── src/
│       │   ├── env.ts              Environment variables validation
│       │   ├── untrusted.ts        Wraps text written by senders before a model reads it
│       │   ├── messages/
│       │   │   ├── inbox.ts        Stores channel messages once, with their conversation
│       │   │   └── handling.ts     Which messages are handled, and the failed attempts
│       │   ├── classification/
│       │   │   ├── taxonomy.ts     Definitions of the request types and priorities
│       │   │   ├── classifier.ts   Classification call to Ollama, with its confidence
│       │   │   ├── duplicate-judge.ts  Asks the model which request repeats a message
│       │   │   └── ollama.ts       Structured call to Ollama and token probabilities
│       │   ├── db/
│       │   │   ├── schema.ts       Data model
│       │   │   ├── client.ts       Database connection
│       │   │   ├── migrate.ts      Migration runner
│       │   │   ├── app-role.ts     Password of the restricted application role
│       │   │   └── seed.ts         Fictitious demo data
│       │   └── requests/
│       │       ├── turn.ts         Sender and project of the message, computed before the model
│       │       ├── classified-turn.ts  Classification of the message and human review rules
│       │       ├── access.ts       The access rule applied to every operation
│       │       ├── inputs.ts       Validated inputs of the operations
│       │       ├── commands.ts     Create, clarify, update, add a message
│       │       ├── duplicates.ts   Candidates for a duplicate, and the check by the model
│       │       ├── review.ts       Review queue: list, review, mark as duplicate
│       │       └── queries.ts      Find, status, list, search, identify
│       └── test/                   Test database setup and fixtures, shared with the server
├── docs/
│   ├── agent.md                    How a message is handled, types, review, measured quality
│   ├── data-model.md               Tables and their columns
│   └── decisions/                  Technical choices and their reasons
├── .github/
│   └── pull_request_template.md
├── .env.example                    Configuration template
├── compose.yaml                    Local PostgreSQL database and mail server
├── .nvmrc                          Node.js version
├── .oxlintrc.json                  Lint rules
├── package.json                    Root scripts
├── pnpm-workspace.yaml             Workspace packages and shared dependency versions
└── tsconfig.base.json              TypeScript settings shared by all packages
```

All dependency versions are declared once in the `catalog` of `pnpm-workspace.yaml`, and packages reference them with `catalog:`.

## Known limitations

- Slack messages and emails are handled one at a time. A message left unhandled by a restart is handled again at the next start.
- Duplicates are found among requests sharing words or spelling with the message: a rewording with no word in common, such as "CB" for "carte bancaire", is missed.
- Attached files are described (name, type, size) but their content is not stored.
- Answers are written in French only.
- The Mastra server API has no authentication yet. It only listens on `localhost` and gives no access to the request tools. Authentication will be required before the server is reachable from elsewhere.
- Mastra keeps its own data (agent memory, traces) in memory and loses it on restart.
- The local model is slow on a CPU: classifying a message takes from 20 s to 60 s, and the agent adds its own calls. Its classification is measured on 80 fictitious messages only, described in [`docs/agent.md`](docs/agent.md).
