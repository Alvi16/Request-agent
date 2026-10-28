import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { useAppTestDatabase, useTestDatabase } from "../../test/database.ts";
import { events, organizations, requests } from "./schema.ts";

useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const permissionDenied = { cause: { code: "42501" } };

async function insertRequestWithEvent() {
  const db = getAppDatabase();
  const [request] = await db
    .insert(requests)
    .values({ type: "BUG", title: "Paiement en échec", sourceChannel: "EMAIL" })
    .returning();
  if (request === undefined) {
    throw new Error("The request was not inserted");
  }
  await db.insert(events).values({ requestId: request.id, type: "CREATED", actorType: "AGENT" });
  return request;
}

describe("application role", () => {
  it("reads, adds and updates rows", async () => {
    const db = getAppDatabase();
    const request = await insertRequestWithEvent();

    const [updated] = await db
      .update(requests)
      .set({ priority: "HIGH" })
      .where(eq(requests.id, request.id))
      .returning();

    expect(request.number).toBe(1);
    expect(updated?.priority).toBe("HIGH");
    expect(await db.select().from(events)).toHaveLength(1);
  });

  it("cannot delete rows", async () => {
    await insertRequestWithEvent();

    await expect(getAppDatabase().delete(requests)).rejects.toMatchObject(permissionDenied);
    await expect(getAppDatabase().delete(organizations)).rejects.toMatchObject(permissionDenied);
  });

  it("cannot rewrite the history", async () => {
    await insertRequestWithEvent();

    await expect(getAppDatabase().update(events).set({ data: {} })).rejects.toMatchObject(
      permissionDenied,
    );
  });

  it("cannot change the schema or empty a table", async () => {
    const db = getAppDatabase();

    await expect(db.execute(sql`truncate requests cascade`)).rejects.toMatchObject(
      permissionDenied,
    );
    await expect(db.execute(sql`create table intruder (id int)`)).rejects.toMatchObject(
      permissionDenied,
    );
    await expect(
      db.execute(sql`alter table requests add column intruder int`),
    ).rejects.toMatchObject(permissionDenied);
  });
});
