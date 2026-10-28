# 002 — Runtime environment and database

- Status: accepted
- Date: 2026-10-28

## Context

Requests must be stored with their history and provenance, found again and updated. Slack, email and the web interface will read and write at the same time. The P1 scope needs text search over requests, and the P3 bonus needs vector search for a knowledge base. The project has no budget for hosting, and the brief does not require a cloud deployment.

## Where the project runs

Everything runs on the development machine, for development and for the demo:

- the Mastra server and Ollama run directly on the machine;
- the database runs in a Docker container, started with Docker Compose.

No cloud resource is used, so nothing is paid and no data leaves the machine. For Slack and email, connections opened from the server (such as Slack Socket Mode and IMAP) will be preferred, so the demo does not need a public address. The final choice is made with each channel.

## Database

| Option                          | Strengths                                                                                                                                                         | Weaknesses                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **PostgreSQL 18 with pgvector** | Default advised by Mastra. Handles concurrent writers. Built-in full-text search. pgvector adds vector search in the same database. Supported until November 2030 | Needs Docker                                                                                                                       |
| SQLite or libSQL                | A single file, nothing to install                                                                                                                                 | Mastra advises against local file databases with several processes in production. A later move to another database would be likely |
| MongoDB                         | Flexible schema                                                                                                                                                   | The data is relational (projects, contacts, requests, messages, history), which a document database fits poorly                    |
| PGlite (PostgreSQL in-process)  | Nothing to install                                                                                                                                                | Still at version 0.x, and a single connection at a time                                                                            |

**Decision:** PostgreSQL 18 with pgvector, using the `pgvector/pgvector:0.8.7-pg18-trixie` image pinned by digest in `compose.yaml`.

Tested on the development machine: PostgreSQL 18.6 starts, the `vector` extension (0.8.7) is enabled, a full-text index finds a request by a word of its title, and data survives a restart of the container. The container uses about 30 MB of RAM.

## Database access from the code

| Option          | Strengths                                                                                                                         | Weaknesses                                                                                                                                                                                      |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Drizzle ORM** | Schema written in TypeScript. Generates readable SQL migrations. Native `vector` column type, distance functions and HNSW indexes | Not yet at version 1.0 (1.0 is a release candidate)                                                                                                                                             |
| Prisma ORM      | Widely known                                                                                                                      | PostgreSQL full-text search is a preview feature. No native `vector` type: the column is declared `Unsupported` and read or written with raw SQL. Its own schema language and a generation step |
| Kysely          | Well-typed queries                                                                                                                | Migrations are written entirely by hand                                                                                                                                                         |

**Decision:** Drizzle ORM. Both key needs, text search (P1) and vector search (P3), are native with Drizzle, while Prisma would rely on a preview feature and raw SQL. Drizzle was tested with the project's TypeScript 7 setup: types check and `drizzle-kit` generates a migration that applies to PostgreSQL 18. It is added with the data model, at the next stage.

Weekly npm downloads in October 2026 were 27.9 million for `drizzle-orm` and 17.3 million for `prisma`. They include indirect installs, so they only indicate adoption.

## Consequences

- Docker is required to run the project. The database listens on `127.0.0.1` only, on port 5433 by default, which avoids a conflict with another PostgreSQL on 5432.
- The database password is read from `.env`, which is never committed. `.env.example` documents it with a placeholder value.
- Mastra keeps its own internal data (agent memory, paused workflows, traces) in memory for now. Its official PostgreSQL storage (`@mastra/pg`) will be added only when a feature needs it.
- Moving to a hosted PostgreSQL later only requires a different connection string.

## Sources

- [Mastra storage](https://mastra.ai/docs/memory/storage)
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/)
- [pgvector](https://github.com/pgvector/pgvector) and its [Docker image](https://hub.docker.com/r/pgvector/pgvector)
- [Drizzle and PostgreSQL extensions](https://orm.drizzle.team/docs/extensions/pg)
- [Drizzle full-text search guide](https://orm.drizzle.team/docs/guides/postgresql-full-text-search)
- [Prisma full-text search](https://www.prisma.io/docs/orm/prisma-client/queries/full-text-search)
- [Prisma and PostgreSQL extensions](https://www.prisma.io/docs/postgres/database/postgres-extensions)
