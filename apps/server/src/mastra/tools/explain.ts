import type {
  actorType,
  eventType,
  requestPriority,
  requestStatus,
  requestType,
} from "@request-agent/core";

// What the tools return, as the model reads it: the codes of the database are replaced by plain
// words, so the model can answer "where is it?" without guessing what NEW means, and does not
// copy codes into its answer. The outcomes recorded for the code keep the codes.

type Words<T extends { enumValues: [string, ...string[]] }> = Record<
  T["enumValues"][number],
  string
>;

const statusWords: Words<typeof requestStatus> = {
  NEW: "new: no one of the team has started on it yet",
  IN_PROGRESS: "in progress: the team is working on it",
  WAITING_FOR_INFO: "waiting for information from the sender",
  RESOLVED: "resolved by the team",
  CLOSED: "closed",
};

const priorityWords: Words<typeof requestPriority> = {
  LOW: "low",
  MEDIUM: "medium",
  HIGH: "high",
  CRITICAL: "critical",
};

const typeWords: Words<typeof requestType> = {
  BUG: "bug",
  FEATURE_REQUEST: "request for a new feature",
  CHANGE_REQUEST: "request to change something delivered",
  EVOLUTION: "improvement of an existing feature",
  SUPPORT: "support question",
  FOLLOW_UP: "follow-up of an earlier request",
  STATUS_REQUEST: "question about the status of a request",
  OTHER: "other message",
};

const eventWords: Words<typeof eventType> = {
  CREATED: "request filed",
  CLASSIFIED: "classified automatically",
  UPDATED: "details changed",
  STATUS_CHANGED: "status changed",
  MESSAGE_ADDED: "a message was added",
  CLARIFICATION_REQUESTED: "a question was asked to the sender",
  REVIEW_REQUESTED: "a question of the sender was passed to the team",
  REVIEWED: "checked by a person of the team",
  MARKED_DUPLICATE: "marked as a duplicate of another request",
};

const actorWords: Words<typeof actorType> = {
  AGENT: "the agent",
  HUMAN: "a person of the team",
  SYSTEM: "an automatic rule",
};

function lookup(words: Record<string, string>, value: unknown): string | undefined {
  return typeof value === "string" && Object.hasOwn(words, value) ? words[value] : undefined;
}

function explainField(key: string, value: unknown): unknown {
  switch (key) {
    case "status": {
      return lookup(statusWords, value) ?? value;
    }
    case "priority": {
      return value === null ? "not set" : (lookup(priorityWords, value) ?? value);
    }
    case "type": {
      return lookup(typeWords, value) ?? lookup(eventWords, value) ?? value;
    }
    case "by": {
      return lookup(actorWords, value) ?? value;
    }
    default: {
      return explainForModel(value);
    }
  }
}

export function explainForModel(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => explainForModel(item));
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, explainField(key, item)]),
    );
  }
  return value;
}
