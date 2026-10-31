import {
  addMessageToRequest,
  createRequest,
  fileUnhandledMessage,
  forwardToTeam,
  getRequestRecord,
  prepareTurn,
  saveStaffAccount,
  unclassifiedTurn,
} from "@request-agent/core";
import {
  alice,
  bruno,
  classified,
  seedDatabase,
  storeMessage,
  useAppTestDatabase,
  useTestDatabase,
} from "@request-agent/core/testing";
import { beforeEach, describe, expect, it } from "vitest";

import { createWebApp } from "./app.ts";
import { maxFailures } from "./sign-in-limiter.ts";

const getDatabase = useTestDatabase();
const getAppDatabase = useAppTestDatabase();

const email = "dana.support@team.example";
const password = "a long staff password";
const origin = "http://localhost";

let app: ReturnType<typeof createWebApp>;

beforeEach(async () => {
  await seedDatabase(getDatabase());
  await saveStaffAccount(getAppDatabase(), { email, name: "Dana Support", password });
  app = createWebApp({ db: getAppDatabase(), timeZone: "Europe/Paris" });
});

function post(path: string, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", origin, ...headers },
    body: new URLSearchParams(fields),
  });
}

async function signIn(): Promise<string> {
  const response = await post("/login", { email, password });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) {
    throw new Error("No session cookie");
  }
  return cookie;
}

async function portalRequest(text: string): Promise<string> {
  const messageId = await storeMessage(getDatabase(), { sender: bruno, bodyText: text });
  const turn = await prepareTurn(getAppDatabase(), {
    messageId,
    trust: "VERIFIED",
    channelAddress: null,
  });
  const result = await createRequest(
    getAppDatabase(),
    classified(turn, { title: "Erreur 500 sur le portail" }, text),
    {},
  );
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.value.request.reference;
}

// Alice works on two projects, so a message she did not tie to one waits for a review.
async function requestToReview(): Promise<string> {
  const messageId = await storeMessage(getDatabase(), {
    sender: alice,
    bodyText: "Le bouton ne marche plus.",
  });
  const turn = await prepareTurn(getAppDatabase(), {
    messageId,
    trust: "VERIFIED",
    channelAddress: null,
  });
  const filed = await fileUnhandledMessage(
    getAppDatabase(),
    await unclassifiedTurn(getAppDatabase(), turn),
  );
  if (filed === undefined) {
    throw new Error("The request was not filed");
  }
  return filed.reference;
}

async function record(reference: string) {
  const found = await getRequestRecord(getAppDatabase(), reference);
  if (found === undefined) {
    throw new Error(`${reference} not found`);
  }
  return found;
}

describe("sign-in", () => {
  it("sends a visitor without a session to the sign-in page", async () => {
    const response = await app.request("/");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/login");
    expect((await post("/requests/REQ-0001/status", { status: "CLOSED" })).status).toBe(401);
  });

  it("opens a session in a protected cookie with the right password", async () => {
    const response = await post("/login", { email, password });

    expect(response.status).toBe(303);
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^session=[\w-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("SameSite=Lax");
    const home = await app.request("/", { headers: { cookie: cookie.split(";")[0] ?? "" } });
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Dana Support");
  });

  it("gives the same answer for a wrong password and an unknown email", async () => {
    const wrongPassword = await post("/login", { email, password: "wrong password" });
    const unknownEmail = await post("/login", { email: "nobody@team.example", password });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.headers.get("set-cookie")).toBe(null);
    expect(await wrongPassword.text()).toContain("E-mail ou mot de passe incorrect.");
    expect(await unknownEmail.text()).toContain("E-mail ou mot de passe incorrect.");
  });

  it("refuses even the right password after too many failures", async () => {
    for (let failure = 0; failure < maxFailures; failure += 1) {
      // oxlint-disable-next-line no-await-in-loop
      await post("/login", { email, password: "wrong password" });
    }

    const response = await post("/login", { email, password });

    expect(response.status).toBe(429);
    expect(response.headers.get("set-cookie")).toBe(null);
  });

  it("refuses a form sent from another site", async () => {
    const cookie = await signIn();
    const reference = await portalRequest("Le portail plante.");

    const response = await post(
      `/requests/${reference}/status`,
      { status: "CLOSED" },
      { origin: "https://evil.example", cookie },
    );

    expect(response.status).toBe(403);
    expect((await record(reference)).status).toBe("NEW");
  });

  it("ends the session when the person signs out", async () => {
    const cookie = await signIn();

    const response = await post("/logout", {}, { cookie });

    expect(response.status).toBe(303);
    expect(response.headers.get("set-cookie")).toMatch(/^session=;/);
    expect((await app.request("/", { headers: { cookie } })).status).toBe(303);
  });
});

describe("pages", () => {
  it("lists and filters requests", async () => {
    const cookie = await signIn();
    const reference = await portalRequest("Le portail plante.");
    const waiting = await requestToReview();

    const all = await (await app.request("/", { headers: { cookie } })).text();
    const filtered = await (
      await app.request("/?needsReview=true&status=", { headers: { cookie } })
    ).text();

    expect(all).toContain(reference);
    expect(all).toContain(waiting);
    expect(all).toContain("2 demandes");
    expect(filtered).toContain(waiting);
    expect(filtered).not.toContain(`>${reference}<`);
  });

  it("finds a request from the start of a word, inside the part that the script replaces", async () => {
    const cookie = await signIn();
    const reference = await portalRequest("Le portail plante.");

    const found = await (await app.request("/?query=porta", { headers: { cookie } })).text();
    const none = await (await app.request("/?query=facture", { headers: { cookie } })).text();

    expect(found).toMatch(new RegExp(`<div id="results">[\\s\\S]*>${reference}<`));
    expect(found).toContain('<p class="muted" role="status">1 demande</p>');
    expect(none).toContain('<p class="muted" role="status">0 demande</p>');
  });

  it("shows the type, status, priority and source as colored badges", async () => {
    const cookie = await signIn();
    await portalRequest("Le portail plante.");

    const list = await (await app.request("/", { headers: { cookie } })).text();

    expect(list).toContain(`<span class="badge badge-gray">Bug</span>`);
    expect(list).toContain(`<span class="badge badge-green">Nouvelle</span>`);
    expect(list).toContain(`<span class="badge badge-red">Haute</span>`);
    expect(list).toContain(`<span class="badge badge-gray">E-mail</span>`);
  });

  it("marks the open page in the navigation", async () => {
    const cookie = await signIn();

    const list = await (await app.request("/", { headers: { cookie } })).text();
    const queue = await (await app.request("/review", { headers: { cookie } })).text();

    expect(list).toContain(`<a href="/" aria-current="page">Demandes</a>`);
    expect(list).not.toContain(`<a href="/review" aria-current="page">`);
    expect(queue).not.toContain(`<a href="/" aria-current="page">`);
    expect(queue).toContain(`<a href="/review" aria-current="page">À revoir</a>`);
  });

  it("refuses unknown filter values", async () => {
    const cookie = await signIn();

    const response = await app.request("/?status=DONE", { headers: { cookie } });

    expect(response.status).toBe(400);
  });

  it("shows the review queue with the reasons", async () => {
    const cookie = await signIn();
    const waiting = await requestToReview();

    const queue = await (await app.request("/review", { headers: { cookie } })).text();

    expect(queue).toContain(waiting);
    expect(queue).toContain("Message non traité par l&#39;agent");
  });

  it("shows a question the agent passed to the team, in the queue and in the history", async () => {
    const cookie = await signIn();
    const reference = await portalRequest("Le portail plante.");
    const messageId = await storeMessage(getDatabase(), {
      sender: bruno,
      bodyText: "C'est pour quand ?",
    });
    const followUp = classified(
      await prepareTurn(getAppDatabase(), { messageId, trust: "VERIFIED", channelAddress: null }),
    );
    await addMessageToRequest(getAppDatabase(), followUp, { reference });
    await forwardToTeam(getAppDatabase(), followUp, { question: "Quand est-ce prévu ?" });

    const queue = await (await app.request("/review", { headers: { cookie } })).text();
    const page = await (
      await app.request(`/requests/${reference}`, { headers: { cookie } })
    ).text();

    expect(queue).toContain("Question transmise à l&#39;équipe");
    expect(page).toContain("Revue demandée");
    expect(page).toContain(
      "raison : Question transmise à l&#39;équipe, question : Quand est-ce prévu ?",
    );
  });

  it("shows a request with its messages, escaping what senders wrote", async () => {
    const cookie = await signIn();
    const reference = await portalRequest(`<script>alert("x")</script> Le portail plante.`);

    const response = await app.request(`/requests/${reference}`, { headers: { cookie } });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; Le portail plante.");
    expect(body).not.toContain("<script>");
    expect(body).toContain("Bruno Leroy");
    expect(body).toContain("Classée");
    expect(body).toContain("confiance : 90 %");
    expect(body).toContain(`<div class="detail-main">`);
    expect(body).toContain(`<aside class="detail-side">`);
  });

  it("answers not found for an unknown request", async () => {
    const cookie = await signIn();

    expect((await app.request("/requests/REQ-9999", { headers: { cookie } })).status).toBe(404);
    expect((await app.request("/requests/nothing", { headers: { cookie } })).status).toBe(404);
  });

  it("forbids scripts of other sites, framing and caching of pages", async () => {
    const cookie = await signIn();

    const response = await app.request("/", { headers: { cookie } });

    expect(response.headers.get("content-security-policy")).toContain("default-src 'none'");
    expect(response.headers.get("content-security-policy")).toContain("script-src 'self';");
    // The script only fetches pages of the site itself.
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'self';");
    expect(response.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(await response.text()).toContain('<script src="/app.js" defer></script>');
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
  });

  it("serves the stylesheet, the script, the icon and the health check without a session", async () => {
    expect((await app.request("/app.css")).headers.get("content-type")).toContain("text/css");
    const script = await app.request("/app.js");
    expect(script.headers.get("content-type")).toContain("text/javascript");
    expect(await script.text()).toContain('getElementById("results")');
    const icon = await app.request("/favicon.svg");
    expect(icon.headers.get("content-type")).toBe("image/svg+xml");
    expect(await icon.text()).toMatch(/^<svg /);
    expect(await (await app.request("/login")).text()).toContain('href="/favicon.svg"');
    expect(await (await app.request("/health")).text()).toBe("ok");
  });
});

describe("actions", () => {
  it("validates a request with corrections, recorded as done by the person", async () => {
    const cookie = await signIn();
    const reference = await requestToReview();

    const response = await post(
      `/requests/${reference}/review`,
      { type: "BUG", priority: "HIGH", projectKey: "SHOP", status: "NEW" },
      { cookie },
    );

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`/requests/${reference}?done=reviewed`);
    const reviewed = await record(reference);
    expect(reviewed).toMatchObject({
      needsReview: false,
      type: "BUG",
      priority: "HIGH",
      projectKey: "SHOP",
    });
    expect(reviewed.history.at(-1)).toMatchObject({
      type: "REVIEWED",
      actorType: "HUMAN",
      actorName: "Dana Support",
    });
    const page = await (
      await app.request(response.headers.get("location") ?? "", { headers: { cookie } })
    ).text();
    expect(page).toContain("Demande validée.");
  });

  it("refuses a review with an unknown project", async () => {
    const cookie = await signIn();
    const reference = await requestToReview();

    const response = await post(
      `/requests/${reference}/review`,
      { projectKey: "NOPE" },
      { cookie },
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain("Projet inconnu.");
    expect((await record(reference)).needsReview).toBe(true);
  });

  it("marks a request as a duplicate of another one", async () => {
    const cookie = await signIn();
    const original = await portalRequest("Le portail plante.");
    const repeated = await portalRequest("Le portail plante encore.");

    const response = await post(
      `/requests/${repeated}/duplicate`,
      { duplicateOf: original.toLowerCase() },
      { cookie },
    );

    expect(response.status).toBe(303);
    expect(await record(repeated)).toMatchObject({ status: "CLOSED", duplicateOf: original });
  });

  it("refuses to mark a request as its own duplicate or of an unknown one", async () => {
    const cookie = await signIn();
    const reference = await portalRequest("Le portail plante.");

    const itself = await post(
      `/requests/${reference}/duplicate`,
      { duplicateOf: reference },
      { cookie },
    );
    const unknown = await post(
      `/requests/${reference}/duplicate`,
      { duplicateOf: "REQ-9999" },
      { cookie },
    );
    const malformed = await post(
      `/requests/${reference}/duplicate`,
      { duplicateOf: "42" },
      { cookie },
    );

    expect([itself.status, unknown.status, malformed.status]).toEqual([400, 400, 400]);
    expect((await record(reference)).status).toBe("NEW");
  });

  it("changes the status of a request", async () => {
    const cookie = await signIn();
    const reference = await portalRequest("Le portail plante.");

    const response = await post(
      `/requests/${reference}/status`,
      { status: "IN_PROGRESS" },
      { cookie },
    );

    expect(response.status).toBe(303);
    const changed = await record(reference);
    expect(changed.status).toBe("IN_PROGRESS");
    expect(changed.history.at(-1)).toMatchObject({
      type: "STATUS_CHANGED",
      actorName: "Dana Support",
      data: { from: "NEW", to: "IN_PROGRESS" },
    });
  });

  it("refuses an unknown status", async () => {
    const cookie = await signIn();
    const reference = await portalRequest("Le portail plante.");

    const response = await post(`/requests/${reference}/status`, { status: "DONE" }, { cookie });

    expect(response.status).toBe(400);
  });
});
