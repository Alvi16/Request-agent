// Adds help articles to the knowledge base, or updates them. Each Markdown file of a folder named
// after a project is one article: its first "# " heading is the title, the rest is the text.
// Usage: pnpm kb:import ./help          (reads ./help/PORTAL/*.md, ./help/SHOP/*.md, ...)
//        pnpm kb:import --demo          (the fictitious articles of the demonstration projects)
import { readdir, readFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { z } from "zod";

import { connectDatabase } from "../src/db/client.ts";
import { loadAppDatabaseEnv, loadKnowledgeEnv } from "../src/env.ts";
import { type ArticleInput, articleInput, saveArticle } from "../src/knowledge/articles.ts";
import { demoArticles } from "../src/knowledge/demo-articles.ts";
import { createOllamaEmbedder } from "../src/knowledge/embedder.ts";

// Longest wait for the vector of one article: about 0.3 s on a CPU once the model is loaded.
const embeddingTimeoutMs = 60_000;

function parseArticle(projectKey: string, file: string, text: string): ArticleInput {
  const heading = /^#\s+(.+)$/m.exec(text);
  const title = heading?.[1] ?? basename(file, ".md");
  const body = heading === null ? text : text.replace(heading[0], "");
  const input = articleInput.safeParse({
    projectKey,
    source: `${projectKey}/${file}`,
    title,
    body,
  });
  if (!input.success) {
    throw new Error(`Invalid article ${projectKey}/${file}:\n${z.prettifyError(input.error)}`);
  }
  return input.data;
}

async function readProjectFolder(folder: string, projectKey: string): Promise<ArticleInput[]> {
  const files = (await readdir(folder)).filter((name) => name.endsWith(".md"));
  return Promise.all(
    files.map(async (file) =>
      parseArticle(projectKey, file, await readFile(join(folder, file), "utf8")),
    ),
  );
}

async function readFolder(folder: string): Promise<ArticleInput[]> {
  const entries = await readdir(folder, { withFileTypes: true });
  const projectsArticles = await Promise.all(
    entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => readProjectFolder(join(folder, entry.name), entry.name.toUpperCase())),
  );
  return projectsArticles.flat();
}

const { values, positionals } = parseArgs({
  options: { demo: { type: "boolean", default: false } },
  allowPositionals: true,
});
const [folder] = positionals;
if (values.demo === (folder !== undefined)) {
  console.error("Give either a folder of articles or --demo.");
  process.exit(1);
}

const env = loadKnowledgeEnv();
const embedder = createOllamaEmbedder({
  baseUrl: env.OLLAMA_BASE_URL,
  model: env.OLLAMA_EMBEDDING_MODEL,
  timeoutMs: embeddingTimeoutMs,
});
const { db, close } = connectDatabase(loadAppDatabaseEnv().APP_DATABASE_URL);
try {
  // pnpm runs the script in packages/core: a relative folder is read from where it was typed.
  const articles =
    folder === undefined
      ? demoArticles
      : await readFolder(resolve(process.env.INIT_CWD ?? process.cwd(), folder));
  for (const article of articles) {
    // One article at a time: the model runs on the CPU, so parallel calls would only queue.
    // oxlint-disable-next-line no-await-in-loop
    await saveArticle(db, embedder, article);
    console.info(`Saved ${article.source}: ${article.title}`);
  }
  console.info(`${articles.length} articles saved with ${embedder.model}.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await close();
}
