import {
  type RequestRecord,
  requestPriority,
  requestStatus,
  requestType,
} from "@request-agent/core";
import { html } from "hono/html";

import { channelBadge, priorityBadge, statusBadge, typeBadge } from "./badges.ts";
import {
  channelLabels,
  eventLabels,
  formatConfidence,
  priorityLabels,
  reviewReasonLabel,
  statusLabels,
  typeLabels,
} from "./labels.ts";
import { type Fragment, options, page, type ViewContext } from "./layout.ts";

// Results of the actions, shown after the redirection that follows them.
export const notices = {
  reviewed: "Demande validée.",
  duplicate: "Demande marquée comme doublon et fermée.",
  status: "Statut mis à jour.",
} as const;

export type Notice = keyof typeof notices;

const actorLabels = { AGENT: "Agent", HUMAN: "Personne", SYSTEM: "Système" } as const;

// Names of the details stored with events, in the words of the team.
const detailLabels: Record<string, string> = {
  title: "titre",
  status: "statut",
  type: "type",
  priority: "priorité",
  confidence: "confiance",
  threshold: "seuil de revue",
  reviewReasons: "raisons de revue",
  model: "modèle",
  promptVersion: "version des instructions",
  reason: "raison",
  changes: "changements",
  question: "question",
  duplicateOf: "doublon de",
  projectKey: "projet",
};
const percentDetails = new Set(["confidence", "threshold"]);

// Event details are stored as JSON: shown as "name : value", with "from → to" for changes.
function describeValue(value: unknown, key = ""): string {
  if (typeof value === "number" && percentDetails.has(key)) {
    return formatConfidence(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((item) =>
      key === "reviewReasons" && typeof item === "string"
        ? reviewReasonLabel(item)
        : describeValue(item),
    );
    return items.length === 0 ? "aucune" : items.join(", ");
  }
  if (value !== null && typeof value === "object" && "from" in value && "to" in value) {
    return `${describeValue(value.from)} → ${describeValue(value.to)}`;
  }
  if (value !== null && typeof value === "object") {
    return Object.entries(value)
      .map(([name, item]) => `${detailLabels[name] ?? name} : ${describeValue(item, name)}`)
      .join(", ");
  }
  if (typeof value === "string" && key === "reason") {
    return reviewReasonLabel(value);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return "—";
}

function describeEventData(data: unknown): string {
  if (data === null || typeof data !== "object" || Object.keys(data).length === 0) {
    return "";
  }
  return describeValue(data);
}

function duplicateLink(record: RequestRecord): Fragment | string {
  if (record.duplicateOf === null) {
    return "—";
  }
  const label = record.status === "CLOSED" ? "Doublon de" : "Doublon possible de";
  return html`${label} <a href="/requests/${record.duplicateOf}">${record.duplicateOf}</a>`;
}

function details(view: ViewContext, record: RequestRecord): Fragment {
  const requester = record.requesterContact;
  return html`<dl>
    <dt>Type</dt>
    <dd>${typeBadge(record.type)}</dd>
    <dt>Statut</dt>
    <dd>${statusBadge(record.status)}</dd>
    <dt>Priorité</dt>
    <dd>${priorityBadge(record.priority)}</dd>
    <dt>Projet</dt>
    <dd>${record.projectKey === null ? "—" : `${record.projectKey} · ${record.projectName}`}</dd>
    <dt>Auteur</dt>
    <dd>
      ${
        requester === null
          ? "—"
          : [requester.name, requester.email, requester.organization]
              .filter((part) => part !== null)
              .join(" · ")
      }
    </dd>
    <dt>Source</dt>
    <dd>${channelBadge(record.sourceChannel)}</dd>
    <dt>Confiance de l'agent</dt>
    <dd>${formatConfidence(record.confidence)}</dd>
    <dt>Doublon</dt>
    <dd>${duplicateLink(record)}</dd>
    ${
      record.duplicates.length === 0
        ? ""
        : html`<dt>Répétée par</dt>
            <dd>
              ${record.duplicates.map(
                (reference) => html`<a href="/requests/${reference}">${reference}</a> `,
              )}
            </dd>`
    }
    <dt>Créée</dt>
    <dd>${view.formatDate(record.createdAt)}</dd>
    <dt>Mise à jour</dt>
    <dd>${view.formatDate(record.updatedAt)}</dd>
    <dt>Résumé</dt>
    <dd>${record.summary ?? "—"}</dd>
    <dt>Description</dt>
    <dd>${record.description ?? "—"}</dd>
  </dl>`;
}

function reviewForm(record: RequestRecord, projects: { key: string; name: string }[]): Fragment {
  const projectLabels = Object.fromEntries(
    projects.map((project) => [project.key, `${project.key} · ${project.name}`]),
  );
  return html`<form method="post" action="/requests/${record.reference}/review">
    <label>
      Type
      <select name="type">
        ${options(requestType.enumValues, typeLabels, record.type)}
      </select>
    </label>
    <label>
      Priorité
      <select name="priority">
        <option value="">${record.priority === null ? "Non définie" : "Inchangée"}</option>
        ${options(requestPriority.enumValues, priorityLabels, record.priority)}
      </select>
    </label>
    <label>
      Projet
      <select name="projectKey">
        <option value="">${record.projectKey === null ? "Aucun" : "Inchangé"}</option>
        ${options(
          projects.map((project) => project.key),
          projectLabels,
          record.projectKey,
        )}
      </select>
    </label>
    <label>
      Statut
      <select name="status">
        ${options(requestStatus.enumValues, statusLabels, record.status)}
      </select>
    </label>
    <button class="primary" type="submit">
      ${record.needsReview ? "Valider la demande" : "Enregistrer les corrections"}
    </button>
  </form>`;
}

// Each action is a card of its own, in the side column of the page.
function actions(record: RequestRecord, projects: { key: string; name: string }[]): Fragment {
  return html`<section class="card">
      <h2>${record.needsReview ? "Valider ou corriger" : "Corriger"}</h2>
      ${
        record.needsReview
          ? html`<p class="review">
              À revoir :
              ${record.reviewReasons.map(reviewReasonLabel).join(", ") || "raison inconnue"}
            </p>`
          : ""
      }
      ${reviewForm(record, projects)}
    </section>
    <section class="card">
      <h2>Changer le statut</h2>
      <form method="post" action="/requests/${record.reference}/status">
        <label>
          Statut
          <select name="status">
            ${options(requestStatus.enumValues, statusLabels, record.status)}
          </select>
        </label>
        <button type="submit">Changer le statut</button>
      </form>
    </section>
    <section class="card">
      <h2>Marquer comme doublon</h2>
      <form method="post" action="/requests/${record.reference}/duplicate">
        <label>
          Demande d'origine
          <input
            name="duplicateOf"
            value="${record.duplicateOf ?? ""}"
            placeholder="REQ-0042"
            pattern="[Rr][Ee][Qq]-[0-9]{1,9}"
            required
          />
        </label>
        <button type="submit">Marquer comme doublon et fermer</button>
      </form>
    </section>`;
}

function messageList(view: ViewContext, record: RequestRecord): Fragment {
  if (record.messages.length === 0) {
    return html`<p class="muted">Aucun message.</p>`;
  }
  return html`${record.messages.map(
    (message) =>
      html`<article class="message ${message.direction === "OUTBOUND" ? "outbound" : ""}">
        <div class="muted">
          ${message.direction === "OUTBOUND" ? "Réponse de l'agent" : "Reçu"} ·
          ${channelLabels[message.channel]} · ${message.authorName ?? message.sender} ·
          ${view.formatDate(message.sentAt)}
        </div>
        ${message.subject === null ? "" : html`<strong>${message.subject}</strong>`}
        <pre>${message.bodyText}</pre>
        ${
          message.attachments.length === 0
            ? ""
            : html`<div class="muted">Pièces jointes :</div>
                <ul class="muted attachments">
                  ${message.attachments.map(
                    (file) =>
                      html`<li>
                        ${
                          file.stored
                            ? html`<a href="/attachments/${file.id}">${file.filename}</a>`
                            : file.filename
                        }
                        (${file.contentType}, ${Math.ceil(file.sizeBytes / 1024)} Ko)
                      </li>`,
                  )}
                </ul>`
        }
      </article>`,
  )}`;
}

function history(view: ViewContext, record: RequestRecord): Fragment {
  return html`<ol class="history">
    ${record.history.map(
      (event) =>
        html`<li>
          <strong>${eventLabels[event.type]}</strong> · ${view.formatDate(event.at)} ·
          ${
            event.actorType === "HUMAN"
              ? (event.actorName ?? actorLabels.HUMAN)
              : actorLabels[event.actorType]
          }
          ${event.channel === null ? "" : ` · ${channelLabels[event.channel]}`}
          ${
            describeEventData(event.data) === ""
              ? ""
              : html`<div class="muted">${describeEventData(event.data)}</div>`
          }
        </li>`,
    )}
  </ol>`;
}

export function requestPage(
  view: ViewContext,
  record: RequestRecord,
  projects: { key: string; name: string }[],
  feedback: { notice?: Notice; error?: string },
): Fragment {
  return page(
    record.reference,
    html`<p><a href="/">← Toutes les demandes</a></p>
      <h1>
        ${record.reference} · ${record.title}
        ${record.needsReview ? html` <span class="review">À revoir</span>` : ""}
      </h1>
      ${
        feedback.notice === undefined
          ? ""
          : html`<p class="notice" role="status">${notices[feedback.notice]}</p>`
      }
      ${
        feedback.error === undefined
          ? ""
          : html`<p class="error" role="alert">${feedback.error}</p>`
      }
      <div class="detail">
        <div class="detail-main">
          <h2>Messages</h2>
          ${messageList(view, record)}
          <h2>Historique</h2>
          ${history(view, record)}
        </div>
        <aside class="detail-side">
          <section class="card">${details(view, record)}</section>
          ${actions(record, projects)}
        </aside>
      </div>`,
    view.staff,
  );
}
