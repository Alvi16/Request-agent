import type { RequestView } from "@request-agent/core";
import { describe, expect, it } from "vitest";

import type { ToolOutcome } from "../tools/request-tools";
import { composeReply, fallbackReply } from "./reply";

const request: RequestView = {
  reference: "REQ-0007",
  type: "BUG",
  status: "IN_PROGRESS",
  priority: "HIGH",
  title: "Export cassé",
  summary: null,
  projectKey: "CRM",
  needsReview: false,
  createdAt: "2026-10-28T09:00:00.000Z",
  updatedAt: "2026-10-28T09:00:00.000Z",
};

describe("composeReply", () => {
  it("says a person will check a request filed for review", () => {
    const outcomes: ToolOutcome[] = [
      {
        tool: "create_request",
        result: {
          ok: true,
          value: { request: { ...request, needsReview: true }, created: true, duplicate: false },
        },
      },
    ];

    expect(composeReply(outcomes, undefined)).toBe(
      "Votre demande est enregistrée sous la référence REQ-0007. Une personne de l'équipe va la vérifier.",
    );
  });

  it("says the message was added to the existing request it repeats", () => {
    const outcomes: ToolOutcome[] = [
      {
        tool: "create_request",
        result: { ok: true, value: { request, created: false, duplicate: true } },
      },
    ];

    expect(composeReply(outcomes, undefined)).toBe(
      "Votre message concerne la demande existante REQ-0007 : il y a été ajouté.",
    );
  });

  it("ignores failed actions and answers for the last one that succeeded", () => {
    const outcomes: ToolOutcome[] = [
      { tool: "add_message_to_request", result: { ok: false, error: "NOT_FOUND" } },
      { tool: "update_request", result: { ok: true, value: request } },
    ];

    expect(composeReply(outcomes, undefined)).toBe("La demande REQ-0007 a été mise à jour.");
  });

  it("lists the requests found", () => {
    const outcomes: ToolOutcome[] = [
      { tool: "search_requests", result: { ok: true, value: [request] } },
    ];

    expect(composeReply(outcomes, undefined)).toBe(
      "Demandes trouvées :\n- REQ-0007 : Export cassé (en cours de traitement)",
    );
  });

  it("falls back to a neutral answer when nothing succeeded", () => {
    const outcomes: ToolOutcome[] = [
      { tool: "find_request", result: { ok: false, error: "NOT_FOUND" } },
    ];

    expect(composeReply(outcomes, undefined)).toBe(fallbackReply);
  });
});
