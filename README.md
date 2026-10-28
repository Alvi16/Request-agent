# Request-agent

Multi-channel AI agent that centralizes requests about the company's projects. It receives messages from Slack and from a dedicated mailbox, understands them, classifies them and stores them as structured requests that can be found, followed and updated. The agent core is built with [Mastra](https://mastra.ai) and runs on a local language model through [Ollama](https://ollama.com).

## Status

The foundations and the data model are in place. The agent tools come next.

| Feature                                                          | Priority | Status      |
| ---------------------------------------------------------------- | -------- | ----------- |
| Monorepo, TypeScript, lint, format and test tooling              | —        | Done        |
| Mastra agent connected to a local Ollama model                   | P0       | Done        |
| Local PostgreSQL database                                        | P0       | Done        |
| Data model and structured storage with history and provenance    | P0       | Done        |
| Typed tools (create, update, find, list, status, search)         | P0       | Not started |
| Classification and uncertainty handling                          | P0       | Not started |
| Slack integration                                                | P0       | Not started |
| Email integration                                                | P0       | Not started |
| Email conversations, duplicates, human validation, web interface | P1       | Not started |
| Embeddable web widget                                            | P2       | Not planned |
| Per-project knowledge base and RAG                               | P3       | Not planned |

## Architecture at a glance

```mermaid
flowchart LR
    Client[HTTP client] --> Server["Mastra server<br/>apps/server"]
    Server --> Agent[Request agent]
    Agent --> Ollama["Ollama<br/>local model"]
    Core["Business core<br/>packages/core"] --> Postgres[("PostgreSQL<br/>Docker")]
    Agent -. next stage .-> Core
```

The business core holds the data model and the database access, with no dependency on any channel. The agent will use it through typed tools at the next stage. Slack and Email will be added as input adapters in front of the same agent. The data model is described in [`docs/data-model.md`](docs/data-model.md).

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

| Variable            | Role                                                                                           | Example value                                                               |
| ------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `POSTGRES_PASSWORD` | Password of the `request_agent` database user, used by Docker Compose                          | `change-me`                                                                 |
| `POSTGRES_PORT`     | Port of the database on the machine (localhost only)                                           | `5433`                                                                      |
| `DATABASE_URL`      | Connection to the development database, as its owner. Used by the migrations and the demo data | `postgresql://request_agent:change-me@127.0.0.1:5433/request_agent`         |
| `APP_DATABASE_URL`  | Connection used by the application, with the restricted `request_agent_app` role               | `postgresql://request_agent_app:change-me-too@127.0.0.1:5433/request_agent` |
| `TEST_DATABASE_URL` | Connection to the test database. Its name must end with `_test`                                | `postgresql://request_agent:change-me@127.0.0.1:5433/request_agent_test`    |
| `OLLAMA_BASE_URL`   | Ollama API endpoint. Must end with `/api`                                                      | `http://127.0.0.1:11434/api`                                                |
| `OLLAMA_MODEL`      | Model used by the agent. It must be pulled first                                               | `ornith:9b`                                                                 |

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

The JSON response contains the answer in the `text` field.

## Tests and code quality

| Command             | What it checks                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm test`         | Tests (Vitest). The model is simulated, Ollama is not needed. The data model tests need the database (`pnpm db:up`) and use the separate test database, created automatically |
| `pnpm typecheck`    | TypeScript types, in strict mode                                                                                                                                              |
| `pnpm lint`         | Lint rules with oxlint, including type-aware rules                                                                                                                            |
| `pnpm format:check` | Formatting with Prettier. `pnpm format` fixes it                                                                                                                              |

## Project structure

```
Request-agent/
├── apps/
│   └── server/                     Mastra server
│       └── src/
│           ├── config.ts           Environment variables validation
│           └── mastra/
│               ├── index.ts        Mastra entry point: registers the agent
│               └── agents/
│                   └── request-agent.ts
├── packages/
│   └── core/                       Business core, independent of any channel
│       ├── drizzle/                SQL migrations, generated from the schema
│       ├── scripts/                Migration and demo data commands
│       ├── src/
│       │   ├── env.ts              Database environment variables validation
│       │   └── db/
│       │       ├── schema.ts       Data model
│       │       ├── client.ts       Database connection
│       │       ├── migrate.ts      Migration runner
│       │       └── seed.ts         Fictitious demo data
│       └── test/                   Test database setup
├── docs/
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

- The agent does not use the database yet: the typed tools come at the next stage. Mastra keeps its own data (agent memory, traces) in memory and loses it on restart.
- The agent has no tools yet: it can answer but cannot create or find requests.
- The local model is slow on a CPU and less reliable than hosted models on ambiguous messages.
