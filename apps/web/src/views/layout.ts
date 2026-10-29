import type { StaffMember } from "@request-agent/core";
import { html } from "hono/html";

// Every value placed in a template with ${} is escaped by Hono, including the text of messages
// written by senders: no page builds HTML from strings by hand.
export type Fragment = ReturnType<typeof html>;

export interface ViewContext {
  staff: StaffMember;
  formatDate: (iso: string) => string;
}

export function page(title: string, body: Fragment, staff?: StaffMember): Fragment {
  return html`<!doctype html>
    <html lang="fr">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${title} · Demandes</title>
        <link rel="stylesheet" href="/app.css" />
      </head>
      <body>
        ${
          staff === undefined
            ? ""
            : html`<header>
                <nav>
                  <a href="/">Demandes</a>
                  <a href="/review">À revoir</a>
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
