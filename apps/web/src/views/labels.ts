import type {
  channel,
  eventType,
  requestPriority,
  requestStatus,
  requestType,
} from "@request-agent/core";

// The team reads French, like the answers of the agent.

type Labels<T extends { enumValues: [string, ...string[]] }> = Record<
  T["enumValues"][number],
  string
>;

export const typeLabels: Labels<typeof requestType> = {
  BUG: "Bug",
  FEATURE_REQUEST: "Nouvelle fonctionnalité",
  CHANGE_REQUEST: "Demande de modification",
  EVOLUTION: "Évolution",
  SUPPORT: "Support",
  FOLLOW_UP: "Suivi",
  STATUS_REQUEST: "Demande de statut",
  OTHER: "Autre",
};

export const statusLabels: Labels<typeof requestStatus> = {
  NEW: "Nouvelle",
  IN_PROGRESS: "En cours",
  WAITING_FOR_INFO: "En attente d'informations",
  RESOLVED: "Résolue",
  CLOSED: "Fermée",
};

export const priorityLabels: Labels<typeof requestPriority> = {
  LOW: "Basse",
  MEDIUM: "Moyenne",
  HIGH: "Haute",
  CRITICAL: "Critique",
};

export const channelLabels: Labels<typeof channel> = {
  SLACK: "Slack",
  EMAIL: "E-mail",
  WIDGET: "Widget",
};

export const eventLabels: Labels<typeof eventType> = {
  CREATED: "Créée",
  CLASSIFIED: "Classée",
  UPDATED: "Modifiée",
  STATUS_CHANGED: "Statut changé",
  MESSAGE_ADDED: "Message ajouté",
  CLARIFICATION_REQUESTED: "Précision demandée",
  REVIEW_REQUESTED: "Revue demandée",
  REVIEWED: "Revue faite",
  MARKED_DUPLICATE: "Marquée comme doublon",
};

const reviewReasonLabels: Record<string, string> = {
  LOW_CONFIDENCE: "Confiance de l'agent trop faible",
  PROJECT_AMBIGUOUS: "Plusieurs projets possibles",
  PROJECT_UNKNOWN: "Projet inconnu",
  UNVERIFIED_SENDER: "Expéditeur non vérifié",
  POSSIBLE_DUPLICATE: "Doublon possible",
  UNHANDLED: "Message non traité par l'agent",
  QUESTION_FOR_TEAM: "Question transmise à l'équipe",
};

// Reasons are stored as text in the history, so an unknown one is shown as it is.
export const reviewReasonLabel = (reason: string) => reviewReasonLabels[reason] ?? reason;

export function dateFormatter(timeZone: string): (iso: string) => string {
  const format = new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone,
  });
  return (iso) => format.format(new Date(iso));
}

export const formatConfidence = (confidence: number | null) =>
  confidence === null ? "—" : `${Math.round(confidence * 100)} %`;
