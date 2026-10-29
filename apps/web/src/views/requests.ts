import {
  channel,
  type ConsoleRequest,
  consolePageSize,
  type listRequestsInput,
  type ReviewItem,
  requestStatus,
  requestType,
} from "@request-agent/core";
import { html } from "hono/html";
import type { z } from "zod";

import {
  channelLabels,
  formatConfidence,
  priorityLabels,
  reviewReasonLabel,
  statusLabels,
  typeLabels,
} from "./labels.ts";
import { type Fragment, options, page, type ViewContext } from "./layout.ts";

type Filters = z.output<typeof listRequestsInput>;

function requestRows(view: ViewContext, items: ConsoleRequest[]): Fragment {
  if (items.length === 0) {
    return html`<p class="muted">Aucune demande.</p>`;
  }
  return html`<div class="table">
    <table>
      <thead>
        <tr>
          <th>Référence</th>
          <th>Titre</th>
          <th>Type</th>
          <th>Projet</th>
          <th>Auteur</th>
          <th>Statut</th>
          <th>Priorité</th>
          <th>Source</th>
          <th>Confiance</th>
          <th>Mise à jour</th>
        </tr>
      </thead>
      <tbody>
        ${items.map(
          (item) =>
            html`<tr>
              <td><a href="/requests/${item.reference}">${item.reference}</a></td>
              <td>
                ${item.title} ${item.needsReview ? html` <span class="review">À revoir</span>` : ""}
              </td>
              <td>${typeLabels[item.type]}</td>
              <td>${item.projectKey ?? "—"}</td>
              <td>${item.requester ?? "—"}</td>
              <td>${statusLabels[item.status]}</td>
              <td>${item.priority === null ? "—" : priorityLabels[item.priority]}</td>
              <td>${channelLabels[item.sourceChannel]}</td>
              <td>${formatConfidence(item.confidence)}</td>
              <td>${view.formatDate(item.updatedAt)}</td>
            </tr>`,
        )}
      </tbody>
    </table>
  </div>`;
}

// Link to another page of the same list, keeping the filters.
function pageLink(filters: Filters, pageNumber: number): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, page: pageNumber })) {
    if (value !== undefined) {
      query.set(key, String(value));
    }
  }
  return `/?${query.toString()}`;
}

export function requestListPage(
  view: ViewContext,
  filters: Filters,
  result: { items: ConsoleRequest[]; total: number },
  projects: { key: string; name: string }[],
): Fragment {
  const pageCount = Math.max(1, Math.ceil(result.total / consolePageSize));
  const projectLabels = Object.fromEntries(projects.map((project) => [project.key, project.key]));
  return page(
    "Demandes",
    html`<h1>Demandes</h1>
      <form class="filters" method="get" action="/">
        <label>
          Recherche
          <input
            type="search"
            name="query"
            value="${filters.query ?? ""}"
            placeholder="Mots ou REQ-0042"
          />
        </label>
        <label>
          Projet
          <select name="projectKey">
            <option value="">Tous</option>
            ${options(
              projects.map((project) => project.key),
              projectLabels,
              filters.projectKey?.toUpperCase(),
            )}
          </select>
        </label>
        <label>
          Statut
          <select name="status">
            <option value="">Tous</option>
            ${options(requestStatus.enumValues, statusLabels, filters.status)}
          </select>
        </label>
        <label>
          Type
          <select name="type">
            <option value="">Tous</option>
            ${options(requestType.enumValues, typeLabels, filters.type)}
          </select>
        </label>
        <label>
          Source
          <select name="channel">
            <option value="">Toutes</option>
            ${options(channel.enumValues, channelLabels, filters.channel)}
          </select>
        </label>
        <label>
          Revue
          <select name="needsReview">
            <option value="">Toutes</option>
            <option value="true" ${filters.needsReview === true ? "selected" : ""}>À revoir</option>
          </select>
        </label>
        <button class="primary" type="submit">Filtrer</button>
        <a href="/">Effacer</a>
      </form>
      <p class="muted">${result.total} demande${result.total > 1 ? "s" : ""}</p>
      ${requestRows(view, result.items)}
      ${
        pageCount > 1
          ? html`<nav class="pages">
              ${
                filters.page > 1
                  ? html`<a href="${pageLink(filters, filters.page - 1)}">Page précédente</a>`
                  : ""
              }
              <span>Page ${filters.page} sur ${pageCount}</span>
              ${
                filters.page < pageCount
                  ? html`<a href="${pageLink(filters, filters.page + 1)}">Page suivante</a>`
                  : ""
              }
            </nav>`
          : ""
      }`,
    view.staff,
  );
}

export function reviewQueuePage(view: ViewContext, queue: ReviewItem[]): Fragment {
  return page(
    "À revoir",
    html`<h1>À revoir</h1>
      <p class="muted">
        Demandes dont l'agent n'est pas sûr, les plus anciennes d'abord. Ouvrez-en une pour la
        valider ou la corriger.
      </p>
      ${
        queue.length === 0
          ? html`<p>Aucune demande à revoir.</p>`
          : html`<div class="table">
              <table>
                <thead>
                  <tr>
                    <th>Référence</th>
                    <th>Titre</th>
                    <th>Raisons</th>
                    <th>Type</th>
                    <th>Projet</th>
                    <th>Créée</th>
                  </tr>
                </thead>
                <tbody>
                  ${queue.map(
                    ({ request, reasons }) =>
                      html`<tr>
                        <td><a href="/requests/${request.reference}">${request.reference}</a></td>
                        <td>${request.title}</td>
                        <td>${reasons.map(reviewReasonLabel).join(", ") || "—"}</td>
                        <td>${typeLabels[request.type]}</td>
                        <td>${request.projectKey ?? "—"}</td>
                        <td>${view.formatDate(request.createdAt)}</td>
                      </tr>`,
                  )}
                </tbody>
              </table>
            </div>`
      }`,
    view.staff,
  );
}
