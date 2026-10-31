# 010 — A knowledge base per project, searched by meaning

- Status: accepted
- Date: 2026-10-31

## Context

Many support questions are about how to use a product: "Comment ajouter un utilisateur ?", "Où télécharger ma facture ?". Until now, the agent passed them to the team (decision 009), and a person answered each one. The P3 bonus of the brief asks for a knowledge base per project, and answers to support questions without a person.

People rarely use the words of the help articles. "J'ai oublié mon code d'accès" is answered by "Réinitialiser un mot de passe", and "Un client veut récupérer son argent" by "Rembourser une commande". The search must find an article by its meaning.

## Measure

10 fictitious help articles for the three demonstration projects, and 22 questions written without the words of the articles: 18 with an answer in an article of their project, 4 without any. Each method ranks the articles of the project of the question. Scratch script run on the development machine, CPU only.

| Method                                                                   | Right article first | Right article in the first 3 | Time for 32 texts |
| ------------------------------------------------------------------------ | ------------------- | ---------------------------- | ----------------- |
| **`qwen3-embedding:0.6b` (Ollama, 639 MB, 1024 dimensions)**             | **17 / 18**         | **18 / 18**                  | 9.8 s             |
| `bge-m3` (Ollama, 1.2 GB, 1024 dimensions)                               | 17 / 18             | 18 / 18                      | 7.4 s             |
| PostgreSQL full-text search in French (`websearch_to_tsquery`, as today) | 0 / 18              | 0 / 18                       | —                 |

- The full-text search requires every word of the question in the article, so a question in other words finds nothing.
- Both embedding models find the answer in their first 3 articles every time. `qwen3-embedding:0.6b` is half the size of `bge-m3`, which matters on a machine where the main model already takes 6 GB (decision 009). It is told what the question looks for, as its model card advises; the articles are embedded as they are.
- No score separates a question that has an answer from one that has none. A question without answer scored 0.529, while a right article scored as low as 0.441. A threshold would either drop right answers or keep wrong ones.

## Options for storage and search

| Option                                                                                          | Assessment                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A separate vector database                                                                      | Another service to run, back up and secure, for a few hundred articles                                                                                                                                                                                                               |
| The vector store and query tool of Mastra (`@mastra/rag`, `@mastra/pg`)                         | Two new dependencies, with their own tables and connection outside the migrations and the restricted application role. The rule of which articles a sender may read would have to be added around them                                                                               |
| **A `knowledge_articles` table in the same PostgreSQL, with pgvector, and a typed Mastra tool** | **Chosen.** pgvector 0.8.7 is already in the database image, and Drizzle has a native `vector` column, as planned in [decision 002](002-runtime-and-database.md). The table has a migration like the others, the application role reads it, and the access rule is part of the query |

## How it works

1. Each article belongs to a project. `pnpm kb:import <folder>` reads one Markdown file per article from a folder per project, such as `help/PORTAL/factures.md`: the first `# ` heading is the title. Importing the same file again updates its article. `pnpm kb:import --demo` loads the 10 fictitious articles of the measure.
2. The vector of each article is computed once, when it is imported, with the Ollama `/api/embed` endpoint. The model name is stored with the vector: a search only compares vectors of its own model, so changing the model needs the articles to be imported again.
3. The agent has a new tool, `search_knowledge_base`. It searches the articles of the projects the verified sender works on, and returns the 3 closest ones with their text. An unverified sender does not get the tool.
4. The agent reads the articles and answers only from an article that answers the question. Since no score tells whether one does, the model decides, and the text it writes still goes through the answer check of decision 009.
5. A `SUPPORT` question answered from an article gets no request of its own, like a question about a request (decision 009). When no article answers, the agent files the message as a request, or passes the question to the team, as before.
6. The answer written by code, when no answer of the model passes the check, never quotes an article: code cannot tell whether an article answers the question.

## Measure with the real agent

With `ornith:9b` and `qwen3-embedding:0.6b` on the development machine, the whole path of 4 messages, from the classification to the answer:

| Message                                                                               | Result                                                                                                           | Time  |
| ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ----- |
| Bruno (PORTAL): "Bonjour, comment ajouter un utilisateur au portail ?"                | Answered from "Ajouter un utilisateur au portail", with its steps and the 72 hours of the invitation. No request | 354 s |
| Bruno: "Vous êtes joignables le samedi ?"                                             | Answered from "Horaires du support": not on Saturdays, Monday to Friday from 9 to 18. No request                 | 147 s |
| Bruno: "Est-ce que le portail a une application mobile ?"                             | No article answers: the question is passed to the team, on a new request waiting for review                      | 216 s |
| Alice (SHOP and CRM): "Comment rembourser une commande d'un client sur la boutique ?" | Answered from "Rembourser une commande". The 3 articles searched were all of her projects: none of PORTAL        | 154 s |

## Consequences

- Questions on how to use a product get an answer at once, without a person, when an article answers them.
- An answer is only as good as the articles: they must be written and kept up to date by the team, outside this project.
- A support question answered from an article leaves no request. If the model judges wrongly that an article answers, the team does not see the question. The message is still stored with its conversation.
- Articles longer than 8000 characters are refused: a long article mixes subjects and matches each question less well, so its author splits it. 8000 characters of the French demo articles take 2132 tokens, as measured with `/api/embed`, within the 4096 tokens of context that Ollama gives the model, as shown by `ollama ps`.
- A second model runs in Ollama, `qwen3-embedding:0.6b`, which takes 1.2 GB more in memory once loaded, as shown by `ollama ps`. It must be pulled with `ollama pull qwen3-embedding:0.6b`. Another model of 1024 dimensions can be set with `OLLAMA_EMBEDDING_MODEL`.

## Sources

- [Ollama API, generate embeddings (`/api/embed`)](https://github.com/ollama/ollama/blob/main/docs/api.md#generate-embeddings)
- [Qwen3-Embedding-0.6B model card](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B): instruction given with queries, 1024 dimensions, 32k tokens of context
- [pgvector 0.8](https://github.com/pgvector/pgvector): `vector` type, cosine distance `<=>`, HNSW index with `vector_cosine_ops`
- [Drizzle ORM, pgvector support](https://orm.drizzle.team/docs/guides/vector-similarity-search): `vector` column, `cosineDistance`, HNSW index
