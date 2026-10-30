import {
  authenticateStaff,
  changeRequestStatus,
  changeStatusInput,
  closeSession,
  type Database,
  findSession,
  getRequestRecord,
  listProjects,
  listRequests,
  listRequestsInput,
  listReviewQueue,
  markDuplicate,
  markDuplicateInput,
  openSession,
  reviewRequest,
  reviewRequestInput,
  type StaffMember,
} from "@request-agent/core";
import { type Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { csrf } from "hono/csrf";
import { HTTPException } from "hono/http-exception";
import { secureHeaders } from "hono/secure-headers";

import { createSignInLimiter, type SignInLimiter } from "./sign-in-limiter.ts";
import { dateFormatter } from "./views/labels.ts";
import { icon } from "./views/icon.ts";
import type { Fragment, ViewContext } from "./views/layout.ts";
import { type Notice, notices, requestPage } from "./views/request.ts";
import { requestListPage, reviewQueuePage } from "./views/requests.ts";
import { script } from "./views/script.ts";
import { signInPage } from "./views/sign-in.ts";
import { stylesheet } from "./views/style.ts";

export interface WebAppOptions {
  db: Database;
  timeZone: string;
  limiter?: SignInLimiter;
  // Called when a request fails unexpectedly, so the error is logged without being shown.
  onError?: (error: Error) => void;
}

type Env = { Variables: { staff: StaffMember; sessionToken: string } };

const sessionCookie = "session";
const invalidCredentials = "E-mail ou mot de passe incorrect.";
const tooManyAttempts = "Trop de tentatives. Réessayez dans 15 minutes.";

const isNotice = (value: string): value is Notice => Object.hasOwn(notices, value);

// Empty form fields leave a value unchanged.
function formValue(form: Record<string, unknown>, name: string): string | undefined {
  const value = form[name];
  return typeof value === "string" && value !== "" ? value : undefined;
}

export function createWebApp(options: WebAppOptions) {
  const { db } = options;
  const limiter = options.limiter ?? createSignInLimiter();
  const formatDate = dateFormatter(options.timeZone);
  const app = new Hono<Env>();
  const view = (c: Context<Env>): ViewContext => ({ staff: c.get("staff"), formatDate });
  const render = (c: Context<Env>, fragment: Fragment, status: 200 | 400 | 401 | 404 | 429 = 200) =>
    c.html(fragment, status);

  // Only the script and stylesheet of this site: nothing inline and no resource from elsewhere
  // (OWASP Secure Headers Project).
  app.use(
    secureHeaders({
      contentSecurityPolicy: {
        defaultSrc: ["'none'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        baseUri: ["'none'"],
      },
    }),
  );
  // Forms are only accepted from pages of this site, checked with the Origin and Sec-Fetch-Site
  // headers that browsers send.
  app.use(csrf());
  app.use(async (c, next) => {
    await next();
    // Pages show private data: browsers and proxies must not keep them.
    if (c.res.headers.get("content-type")?.startsWith("text/html") === true) {
      c.header("Cache-Control", "no-store");
    }
  });

  app.get("/health", (c) => c.text("ok"));
  app.get("/app.css", (c) =>
    c.body(stylesheet, 200, { "Content-Type": "text/css; charset=utf-8" }),
  );
  app.get("/favicon.svg", (c) => c.body(icon, 200, { "Content-Type": "image/svg+xml" }));
  app.get("/app.js", (c) =>
    c.body(script, 200, { "Content-Type": "text/javascript; charset=utf-8" }),
  );

  app.get("/login", (c) => render(c, signInPage()));
  app.post("/login", async (c) => {
    const form = await c.req.parseBody();
    const email = formValue(form, "email") ?? "";
    const password = formValue(form, "password") ?? "";
    if (limiter.isLocked(email)) {
      return render(c, signInPage(tooManyAttempts, email), 429);
    }
    const staff = await authenticateStaff(db, email, password);
    if (staff === undefined) {
      limiter.recordFailure(email);
      return render(c, signInPage(invalidCredentials, email), 401);
    }
    limiter.recordSuccess(email);
    const { token, expiresAt } = await openSession(db, staff.contactId);
    // Browsers keep Secure cookies over https, and on localhost except Safari.
    setCookie(c, sessionCookie, token, {
      httpOnly: true,
      secure: true,
      sameSite: "Lax",
      path: "/",
      expires: expiresAt,
    });
    return c.redirect("/", 303);
  });

  // Every other page needs an open session.
  app.use(async (c, next) => {
    const token = getCookie(c, sessionCookie);
    const staff = token === undefined ? undefined : await findSession(db, token);
    if (token === undefined || staff === undefined) {
      return c.req.method === "GET" ? c.redirect("/login", 303) : c.text("Unauthorized", 401);
    }
    c.set("staff", staff);
    c.set("sessionToken", token);
    return next();
  });

  app.post("/logout", async (c) => {
    await closeSession(db, c.get("sessionToken"));
    deleteCookie(c, sessionCookie, { path: "/", secure: true });
    return c.redirect("/login", 303);
  });

  app.get("/", async (c) => {
    const filters = listRequestsInput.safeParse(c.req.query());
    if (!filters.success) {
      return c.text("Invalid filters", 400);
    }
    const [result, projects] = await Promise.all([
      listRequests(db, filters.data),
      listProjects(db),
    ]);
    return render(c, requestListPage(view(c), filters.data, result, projects));
  });

  app.get("/review", async (c) => render(c, reviewQueuePage(view(c), await listReviewQueue(db))));

  const showRequest = async (
    c: Context<Env>,
    feedback: { notice?: Notice; error?: string },
    status: 200 | 400 = 200,
  ) => {
    const reference = c.req.param("reference") ?? "";
    const [record, projects] = await Promise.all([
      getRequestRecord(db, reference),
      listProjects(db),
    ]);
    if (record === undefined) {
      return c.text("Request not found", 404);
    }
    return render(c, requestPage(view(c), record, projects, feedback), status);
  };

  app.get("/requests/:reference", (c) => {
    const notice = c.req.query("done");
    return showRequest(c, {
      notice: notice !== undefined && isNotice(notice) ? notice : undefined,
    });
  });

  // After an action, the browser is sent back to the request, so reloading does not repeat it.
  const done = (c: Context<Env>, reference: string, notice: Notice) =>
    c.redirect(`/requests/${encodeURIComponent(reference)}?done=${notice}`, 303);

  app.post("/requests/:reference/review", async (c) => {
    const form = await c.req.parseBody();
    const input = reviewRequestInput.safeParse({
      reference: c.req.param("reference"),
      changes: {
        type: formValue(form, "type"),
        priority: formValue(form, "priority"),
        projectKey: formValue(form, "projectKey"),
        status: formValue(form, "status"),
      },
    });
    if (!input.success) {
      return showRequest(c, { error: "Valeurs invalides." }, 400);
    }
    const result = await reviewRequest(db, { contactId: c.get("staff").contactId }, input.data);
    if (!result.ok) {
      return result.error === "NOT_FOUND"
        ? c.text("Request not found", 404)
        : showRequest(c, { error: "Projet inconnu." }, 400);
    }
    return done(c, result.value.reference, "reviewed");
  });

  app.post("/requests/:reference/duplicate", async (c) => {
    const form = await c.req.parseBody();
    const input = markDuplicateInput.safeParse({
      reference: c.req.param("reference"),
      duplicateOf: formValue(form, "duplicateOf")?.trim().toUpperCase(),
    });
    if (!input.success) {
      return showRequest(c, { error: "Référence invalide : écrivez par exemple REQ-0042." }, 400);
    }
    const result = await markDuplicate(db, { contactId: c.get("staff").contactId }, input.data);
    if (!result.ok) {
      return showRequest(
        c,
        {
          error:
            result.error === "SAME_REQUEST"
              ? "Une demande ne peut pas être le doublon d'elle-même."
              : "Demande d'origine introuvable.",
        },
        400,
      );
    }
    return done(c, result.value.reference, "duplicate");
  });

  app.post("/requests/:reference/status", async (c) => {
    const form = await c.req.parseBody();
    const input = changeStatusInput.safeParse({
      reference: c.req.param("reference"),
      status: formValue(form, "status"),
    });
    if (!input.success) {
      return showRequest(c, { error: "Statut invalide." }, 400);
    }
    const result = await changeRequestStatus(
      db,
      { contactId: c.get("staff").contactId },
      input.data,
    );
    if (!result.ok) {
      return c.text("Request not found", 404);
    }
    return done(c, input.data.reference.toUpperCase(), "status");
  });

  app.notFound((c) => c.text("Not found", 404));
  app.onError((error, c) => {
    // Refusals of the middlewares, such as a form from another site, keep their status.
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    options.onError?.(error);
    return c.text("Internal error", 500);
  });

  return app;
}
