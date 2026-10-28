# Request-agent

Multi-channel AI agent that centralizes requests about the company's projects. It receives messages from Slack and from a dedicated mailbox, understands them, classifies them and stores them as structured requests that can be found, followed and updated. The agent core is built with [Mastra](https://mastra.ai) and runs on a local language model through [Ollama](https://ollama.com).

## Status

The foundations, the data model, the agent tools and the classification are in place. The Slack and Email channels come next.

| Feature                                                          | Priority | Status      |
| ---------------------------------------------------------------- | -------- | ----------- |
| Monorepo, TypeScript, lint, format and test tooling              | —        | Done        |
| Mastra agent connected to a local Ollama model                   | P0       | Done        |
| Local PostgreSQL database                                        | P0       | Done        |
| Data model and structured storage with history and provenance    | P0       | Done        |
| Typed tools (create, update, find, list, status, search)         | P0       | Done        |
| Classification and uncertainty handling                          | P0       | Done        |
| Slack integration                                                | P0       | Not started |
| Email integration                                                | P0       | Not started |
| Email conversations, duplicates, human validation, web interface | P1       | Not started |
| Embeddable web widget                                            | P2       | Not planned |
| Per-project knowledge base and RAG                               | P3       | Not planned |

## Architecture at a glance

```mermaid
flowchart LR
    Channels["Slack, Email<br/>next stages"] -.-> Handler["Message handler<br/>apps/server"]
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

| Variable                          | Role                                                                                           | Example value                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD`               | Password of the `request_agent` database user, used by Docker Compose                          | `change-me`                                                                 |
| `POSTGRES_PORT`                   | Port of the database on the machine (localhost only)                                           | `5433`                                                                      |
| `DATABASE_URL`                    | Connection to the development database, as its owner. Used by the migrations and the demo data | `postgresql://request_agent:change-me@127.0.0.1:5433/request_agent`         |
| `APP_DATABASE_URL`                | Connection used by the application, with the restricted `request_agent_app` role               | `postgresql://request_agent_app:change-me-too@127.0.0.1:5433/request_agent` |
| `TEST_DATABASE_URL`               | Connection to the test database. Its name must end with `_test`                                | `postgresql://request_agent:change-me@127.0.0.1:5433/request_agent_test`    |
| `OLLAMA_BASE_URL`                 | Ollama API endpoint. Must end with `/api`                                                      | `http://127.0.0.1:11434/api`                                                |
| `OLLAMA_MODEL`                    | Model used by the agent. It must be pulled first                                               | `ornith:9b`                                                                 |
| `CLASSIFICATION_REVIEW_THRESHOLD` | Optional. Below this confidence, from 0 to 1, a request waits for a human review               | `0.8` (default)                                                             |

Set a password of your choice, and use the same password and port in `DATABASE_URL` and `TEST_DATABASE_URL`. Docker Compose refuses to start the database without a password. This password is applied only when the database is created, at the first start: changing it later has no effect on the existing database.

Choose another password for `APP_DATABASE_URL`. `pnpm db:migrate` applies it to the `request_agent_app` role each time it runs, so it can be changed later.

The server refuses to start and names the faulty variable when one of them is missing or invalid.

## Running

Start the database. The command waits until it is ready:

```bash
pnpm db:up
```

Its data is kept in a Docker volume. `pnpm db:down` stops it without deleting the data.

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

## Usage

Send a message to the agent:

```bash
curl -X POST http://localhost:4111/api/agents/request-agent/generate \
  -H 'Content-Type: application/json' \
  -d '{"messages":[{"role":"user","content":"Bonjour"}]}'
```

The JSON response contains the answer in the `text` field. This route reaches the agent without its request tools: they are only given to messages received through a channel, which will be connected at the next stages.

## Tests and code quality

| Command                    | What it checks                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm test`                | Tests (Vitest). The model is simulated, Ollama is not needed. The tests need the database (`pnpm db:up`) and use the separate test database, created automatically |
| `pnpm typecheck`           | TypeScript types, in strict mode                                                                                                                                   |
| `pnpm lint`                | Lint rules with oxlint, including type-aware rules                                                                                                                 |
| `pnpm format:check`        | Formatting with Prettier. `pnpm format` fixes it                                                                                                                   |
| `pnpm eval:classification` | Quality of the classifier on labeled messages, with the real model. Needs Ollama and takes 30 to 60 minutes on a CPU, so it is not part of `pnpm test`             |

## Project structure

```
Request-agent/
├── apps/
│   └── server/                     Mastra server
│       └── src/
│           ├── config.ts           Environment variables validation
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
│       │   ├── classification/
│       │   │   ├── taxonomy.ts     Definitions of the request types and priorities
│       │   │   └── classifier.ts   Classification call to Ollama, with its confidence
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
│       │       └── queries.ts      Find, status, list, search, identify
│       └── test/                   Test database setup and fixtures, shared with the server
├── docs/
│   ├── agent.md                    How a message is handled, types, review, measured quality
│   ├── data-model.md               Tables and their columns
│   └── decisions/                  Technical choices and their reasons
├── .github/
│   └── pull_request_template.md
├── .env.example                    Configuration template
├── compose.yaml                    Local PostgreSQL database
├── .nvmrc                          Node.js version
├── .oxlintrc.json                  Lint rules
├── package.json                    Root scripts
├── pnpm-workspace.yaml             Workspace packages and shared dependency versions
└── tsconfig.base.json              TypeScript settings shared by all packages
```

All dependency versions are declared once in the `catalog` of `pnpm-workspace.yaml`, and packages reference them with `catalog:`.

## Known limitations

- No channel is connected yet: the message handler is exercised by the tests only. Slack and Email come at the next stages.
- The Mastra server API has no authentication yet. It only listens on `localhost` and gives no access to the request tools. Authentication will be required before the server is reachable from elsewhere.
- Mastra keeps its own data (agent memory, traces) in memory and loses it on restart.
- The local model is slow on a CPU: classifying a message takes from 20 s to 60 s, and the agent adds its own calls. Its classification is measured on 80 fictitious messages only, described in [`docs/agent.md`](docs/agent.md).
