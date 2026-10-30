import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { embeddingDimensions, knowledgeArticles, projects } from "../db/schema.ts";
import { seedDatabase } from "../db/seed.ts";
import type { Actor } from "../requests/turn.ts";
import { articleInput, saveArticle, searchKnowledge } from "./articles.ts";
import type { Embedder } from "./embedder.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

// Gives each word its own dimension, so texts sharing words are close in meaning, the way a real
// model places them, without calling one.
function wordEmbedder(model = "test-model"): Embedder & { calls: number } {
  const embedder = {
    model,
    calls: 0,
    embed: (texts: string[]) => {
      embedder.calls += 1;
      return Promise.resolve(
        texts.map((text) => {
          const vector = Array.from({ length: embeddingDimensions }, () => 0);
          for (const word of text.toLowerCase().match(/\p{L}{4,}/gu) ?? []) {
            const dimension = Array.from(word, (char) => char.charCodeAt(0)).reduce(
              (sum, code) => sum + code,
              0,
            );
            vector[dimension % embeddingDimensions] = 1;
          }
          return vector;
        }),
      );
    },
  };
  return embedder;
}

async function projectId(key: string): Promise<string> {
  const [project] = await getDatabase()
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.key, key));
  if (project === undefined) {
    throw new Error(`No project ${key}`);
  }
  return project.id;
}

async function contactOf(...keys: string[]): Promise<Actor> {
  return {
    kind: "contact",
    contactId: "00000000-0000-7000-8000-000000000000",
    projectIds: await Promise.all(keys.map(projectId)),
  };
}

const invoices = {
  projectKey: "PORTAL",
  source: "PORTAL/factures.md",
  title: "Télécharger ses factures",
  body: "Les factures sont disponibles dans Facturation, au format PDF.",
};
const password = {
  projectKey: "PORTAL",
  source: "PORTAL/mot-de-passe.md",
  title: "Réinitialiser un mot de passe",
  body: "Le lien « Mot de passe oublié » envoie un e-mail de réinitialisation.",
};
const refund = {
  projectKey: "SHOP",
  source: "SHOP/remboursement.md",
  title: "Rembourser une commande",
  body: "Ouvrir Commandes, choisir la commande puis Rembourser. Les factures sont refaites.",
};

beforeEach(async () => {
  await seedDatabase(getDatabase());
});

describe("articleInput", () => {
  it("reads a project key in any case and refuses an empty or too long article", () => {
    expect(articleInput.parse({ ...invoices, projectKey: " portal " }).projectKey).toBe("PORTAL");
    expect(articleInput.safeParse({ ...invoices, body: " " }).success).toBe(false);
    expect(articleInput.safeParse({ ...invoices, body: "x".repeat(8001) }).success).toBe(false);
  });
});

describe("searchKnowledge", () => {
  it("finds the closest articles among the projects of the sender, best first", async () => {
    const embedder = wordEmbedder();
    await Promise.all(
      [invoices, password, refund].map((article) =>
        saveArticle(getAppDatabase(), embedder, article),
      ),
    );

    const hits = await searchKnowledge(
      getAppDatabase(),
      embedder,
      await contactOf("PORTAL"),
      "Où télécharger les factures ?",
    );

    expect(hits.map((hit) => hit.title)).toEqual([invoices.title, password.title]);
    expect(hits[0]).toMatchObject({ project: "PORTAL", body: invoices.body });
    expect(hits[0]?.relevance).toBeGreaterThan(hits[1]?.relevance ?? 1);
  });

  it("gives nothing to an unverified sender or a sender without project", async () => {
    const embedder = wordEmbedder();
    await saveArticle(getAppDatabase(), embedder, invoices);
    const calls = embedder.calls;

    expect(
      await searchKnowledge(getAppDatabase(), embedder, { kind: "anonymous" }, "Mes factures ?"),
    ).toEqual([]);
    expect(
      await searchKnowledge(getAppDatabase(), embedder, await contactOf(), "Factures ?"),
    ).toEqual([]);
    expect(embedder.calls).toBe(calls);
  });

  it("only compares vectors of the same model", async () => {
    await saveArticle(getAppDatabase(), wordEmbedder("old-model"), invoices);

    expect(
      await searchKnowledge(
        getAppDatabase(),
        wordEmbedder("new-model"),
        await contactOf("PORTAL"),
        "Factures ?",
      ),
    ).toEqual([]);
  });
});

describe("saveArticle", () => {
  it("updates the article that came from the same source", async () => {
    const embedder = wordEmbedder();
    await saveArticle(getAppDatabase(), embedder, invoices);
    await saveArticle(getAppDatabase(), embedder, { ...invoices, title: "Factures en ligne" });

    const rows = await getDatabase().select().from(knowledgeArticles);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ title: "Factures en ligne", embeddingModel: "test-model" });
  });

  it("refuses an unknown project", async () => {
    await expect(
      saveArticle(getAppDatabase(), wordEmbedder(), { ...invoices, projectKey: "NOPE" }),
    ).rejects.toThrow("Unknown project NOPE");
  });
});
