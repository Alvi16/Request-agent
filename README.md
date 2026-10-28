# Request-agent

Multi-channel AI agent that centralizes requests about the company's projects. It receives messages from Slack and from a dedicated mailbox, understands them, classifies them and stores them as structured requests that can be found, followed and updated. The agent core is built with [Mastra](https://mastra.ai) and runs on a local language model through [Ollama](https://ollama.com).

## Status

The project is at its foundation stage.

| Feature                                                          | Priority | Status      |
| ---------------------------------------------------------------- | -------- | ----------- |
| Monorepo, TypeScript, lint, format and test tooling              | —        | Done        |
| Mastra agent connected to a local Ollama model                   | P0       | Done        |
| Local PostgreSQL database                                        | P0       | Done        |
| Data model and structured storage with history and provenance    | P0       | Not started |
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
    Server -. next stage .-> Postgres[("PostgreSQL<br/>Docker")]
```

The PostgreSQL database already runs and will store the requests from the next stage. Slack and Email will be added as input adapters in front of the same agent, and the business logic will live in a separate package with no dependency on any channel.

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

Two files are created from their templates. They are never committed.

```bash
cp .env.example .env
cp apps/server/.env.example apps/server/.env
```

`.env`, at the root, configures the database started by Docker Compose:

| Variable            | Role                                                 | Example value |
| ------------------- | ---------------------------------------------------- | ------------- |
| `POSTGRES_PASSWORD` | Password of the `request_agent` database user        | `change-me`   |
| `POSTGRES_PORT`     | Port of the database on the machine (localhost only) | `5433`        |

Set a password of your choice. Docker Compose refuses to start the database without one. The password is applied only when the database is created, at the first start: changing it later has no effect on the existing database.

`apps/server/.env` configures the server:

| Variable          | Role                                             | Example value                |
| ----------------- | ------------------------------------------------ | ---------------------------- |
| `OLLAMA_BASE_URL` | Ollama API endpoint. Must end with `/api`        | `http://127.0.0.1:11434/api` |
| `OLLAMA_MODEL`    | Model used by the agent. It must be pulled first | `ornith:9b`                  |

The server refuses to start and names the faulty variable when one of them is missing or invalid.

## Running

Start the database. The command waits until it is ready:

```bash
pnpm db:up
```

Its data is kept in a Docker volume. `pnpm db:down` stops it without deleting the data.

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

| Command             | What it checks                                                    |
| ------------------- | ----------------------------------------------------------------- |
| `pnpm test`         | Unit tests (Vitest). The model is simulated, Ollama is not needed |
| `pnpm typecheck`    | TypeScript types, in strict mode                                  |
| `pnpm lint`         | Lint rules with oxlint, including type-aware rules                |
| `pnpm format:check` | Formatting with Prettier. `pnpm format` fixes it                  |

## Project structure

```
Request-agent/
├── apps/
│   └── server/                     Mastra server
│       ├── .env.example            Configuration template
│       └── src/
│           ├── config.ts           Environment variables validation
│           └── mastra/
│               ├── index.ts        Mastra entry point: registers the agent
│               └── agents/
│                   └── request-agent.ts
├── docs/
│   └── decisions/                  Technical choices and their reasons
├── .github/
│   └── pull_request_template.md
├── .env.example                    Database configuration template
├── compose.yaml                    Local PostgreSQL database
├── .nvmrc                          Node.js version
├── .oxlintrc.json                  Lint rules
├── package.json                    Root scripts
├── pnpm-workspace.yaml             Workspace packages and shared dependency versions
└── tsconfig.base.json              TypeScript settings shared by all packages
```

All dependency versions are declared once in the `catalog` of `pnpm-workspace.yaml`, and packages reference them with `catalog:`.

## Known limitations

- The database runs but is not used yet: the data model is added at the next stage. Mastra keeps its own data (agent memory, traces) in memory and loses it on restart.
- The agent has no tools yet: it can answer but cannot create or find requests.
- The local model is slow on a CPU and less reliable than hosted models on ambiguous messages.
