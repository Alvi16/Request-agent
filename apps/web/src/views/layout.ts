import type { StaffMember } from "@request-agent/core";
import { html } from "hono/html";

// Every value placed in a template with ${} is escaped by Hono, including the text of messages
// written by senders: no page builds HTML from strings by hand.
export type Fragment = ReturnType<typeof html>;

export interface ViewContext {
  staff: StaffMember;
  formatDate: (iso: string) => string;
}

// Page of the navigation that is open, marked for the screen readers and the stylesheet.
export type Section = "requests" | "review";

const current = (section: Section, active: Section | undefined) =>
  section === active ? html`aria-current="page"` : "";

export function page(
  title: string,
  body: Fragment,
  staff?: StaffMember,
  active?: Section,
): Fragment {
  return html`<!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · Demandes</title>
        <link rel="stylesheet" href="/app.css" />
        <script src="/app.js" defer></script>
      </head>
      <body>
        ${
          staff === undefined
            ? ""
            : html`<header>
                <nav>
                  <a href="/" ${current("requests", active)}>Demandes</a>
                  <a href="/review" ${current("review", active)}>À revoir</a>
                </nav>
                <span class="muted">${staff.name ?? staff.email}</span>
                <form method="post" action="/logout">
                  <button type="submit">Se déconnecter</button>
                </form>
              </header>`
        }
        <main>${body}</main>
      </body>
    </html>`;
}

export function options<T extends string>(
  values: readonly T[],
  labels: Record<T, string>,
  selected: string | null | undefined,
): Fragment[] {
  return values.map(
    (value) =>
      html`<option value="${value}" ${value === selected ? "selected" : ""}>
        ${labels[value]}
      </option>`,
  );
}
