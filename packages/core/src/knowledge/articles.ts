import { and, asc, cosineDistance, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import type { Database } from "../db/client.ts";
import { knowledgeArticles, projects } from "../db/schema.ts";
import type { Actor } from "../requests/turn.ts";
import type { Embedder } from "./embedder.ts";

export const articleInput = z.object({
  projectKey: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{1,9}$/),
  source: z.string().trim().min(1).max(500),
  title: z.string().trim().min(1).max(200),
  // A long article mixes subjects and matches each question less well: its author splits it.
  body: z.string().trim().min(1).max(8000),
});

export type ArticleInput = z.infer<typeof articleInput>;

// Articles given to the agent for a question: enough to hold the answer when the best match is
// second or third, as measured in decision 010, and few enough to keep the prompt short.
export const knowledgeResultCount = 3;

export interface KnowledgeHit {
  project: string;
  title: string;
  body: string;
  // Cosine similarity, from 0 to 1. It ranks the articles but does not tell whether one answers.
  relevance: number;
}

// Adds an article to a project, or updates the article that came from the same source.
export async function saveArticle(
  db: Database,
  embedder: Embedder,
  input: ArticleInput,
): Promise<void> {
  const [project] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.key, input.projectKey));
  if (project === undefined) {
    throw new Error(`Unknown project ${input.projectKey}`);
  }
  const [embedding] = await embedder.embed([`${input.title}\n${input.body}`], "document");
  if (embedding === undefined) {
    throw new Error("The embedding model returned no vector");
  }
  const values = {
    title: input.title,
    body: input.body,
    embeddingModel: embedder.model,
    embedding,
  };
  await db
    .insert(knowledgeArticles)
    .values({ projectId: project.id, source: input.source, ...values })
    .onConflictDoUpdate({
      target: [knowledgeArticles.projectId, knowledgeArticles.source],
      set: values,
    });
}

// The articles closest in meaning to a question, among the projects the sender works on. Anyone
// else, such as an unverified sender, reads none.
export async function searchKnowledge(
  db: Database,
  embedder: Embedder,
  actor: Actor,
  question: string,
): Promise<KnowledgeHit[]> {
  if (actor.kind === "anonymous" || actor.projectIds.length === 0) {
    return [];
  }
  const [vector] = await embedder.embed([question], "query");
  if (vector === undefined) {
    throw new Error("The embedding model returned no vector");
  }
  const distance = cosineDistance(knowledgeArticles.embedding, vector);
  const rows = await db
    .select({
      project: projects.key,
      title: knowledgeArticles.title,
      body: knowledgeArticles.body,
      distance: sql<number>`${distance}`.mapWith(Number),
    })
    .from(knowledgeArticles)
    .innerJoin(projects, eq(projects.id, knowledgeArticles.projectId))
    .where(
      and(
        inArray(knowledgeArticles.projectId, actor.projectIds),
        eq(knowledgeArticles.embeddingModel, embedder.model),
      ),
    )
    .orderBy(asc(distance))
    .limit(knowledgeResultCount);
  return rows.map((row) => ({
    project: row.project,
    title: row.title,
    body: row.body,
    relevance: Math.round((1 - row.distance) * 1000) / 1000,
  }));
}
