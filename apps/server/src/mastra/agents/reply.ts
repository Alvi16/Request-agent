import type { RequestView } from "@request-agent/core";

import type { ToolOutcome } from "../tools/request-tools";

// The answer to the sender is written by code from what the tools really did. A small local model
// mixes its reasoning with its answer and can promise actions nobody performed, so its text is
// never sent.

// Sent when nothing reliable can be said about what happened to the message.
export const fallbackReply =
  "Votre message a bien été reçu. Une personne de l'équipe va le traiter et reviendra vers vous.";

const statusLabels: Record<RequestView["status"], string> = {
  NEW: "enregistrée, en attente de traitement",
  IN_PROGRESS: "en cours de traitement",
  WAITING_FOR_INFO: "en attente d'informations de votre part",
  RESOLVED: "résolue",
  CLOSED: "clôturée",
};

// How many requests a list answer shows, so a reply stays readable.
const listedRequestCount = 10;

// Answer for a message the system filed for a person, after the agent could not handle it.
export function filedForReviewReply(reference: string): string {
  return `Votre message est enregistré sous la référence ${reference}. Une personne de l'équipe va le traiter.`;
}

function filed(request: RequestView): string {
  const review = request.needsReview ? " Une personne de l'équipe va la vérifier." : "";
  return `Votre demande est enregistrée sous la référence ${request.reference}.${review}`;
}

function listed(requests: RequestView[]): string {
  if (requests.length === 0) {
    return "Aucune demande ne correspond.";
  }
  const lines = requests
    .slice(0, listedRequestCount)
    .map(
      (request) => `- ${request.reference} : ${request.title} (${statusLabels[request.status]})`,
    );
  return ["Demandes trouvées :", ...lines].join("\n");
}

// What to tell the sender about one action, or undefined when the action failed.
function describeOutcome(outcome: ToolOutcome): string | undefined {
  let answer: string | undefined;
  if (!outcome.result.ok) {
    return answer;
  }
  switch (outcome.tool) {
    case "request_clarification": {
      answer = outcome.question;
      break;
    }
    case "create_request": {
      const { request, duplicate } = outcome.result.value;
      answer = duplicate
        ? `Votre message concerne la demande existante ${request.reference} : il y a été ajouté.`
        : filed(request);
      break;
    }
    case "add_message_to_request": {
      answer = `Votre message a été ajouté à la demande ${outcome.result.value.reference}.`;
      break;
    }
    case "get_request_status": {
      const { reference, status } = outcome.result.value;
      answer = `La demande ${reference} est ${statusLabels[status]}.`;
      break;
    }
    case "update_request": {
      answer = `La demande ${outcome.result.value.reference} a été mise à jour.`;
      break;
    }
    case "find_request": {
      const { request } = outcome.result.value;
      answer = `La demande ${request.reference} (${request.title}) est ${statusLabels[request.status]}.`;
      break;
    }
    case "list_project_requests":
    case "search_requests": {
      answer = listed(outcome.result.value);
      break;
    }
  }
  return answer;
}

// The answer for what happened to the message. A status given after the message was added to its
// request completes the same answer.
export function composeReply(
  outcomes: ToolOutcome[],
  filedBySystem: RequestView | undefined,
): string {
  if (filedBySystem !== undefined) {
    return filedForReviewReply(filedBySystem.reference);
  }
  const answers = outcomes.map(describeOutcome).filter((answer) => answer !== undefined);
  const added = outcomes.find((o) => o.tool === "add_message_to_request" && o.result.ok);
  const status = outcomes.findLast((o) => o.tool === "get_request_status" && o.result.ok);
  if (added !== undefined && status !== undefined) {
    return [describeOutcome(added), describeOutcome(status)].join(" ");
  }
  const last = answers.at(-1);
  if (last !== undefined) {
    return last;
  }
  return fallbackReply;
}
