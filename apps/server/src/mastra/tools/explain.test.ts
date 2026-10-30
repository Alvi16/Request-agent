import { describe, expect, it } from "vitest";

import { explainForModel } from "./explain";

describe("explainForModel", () => {
  it("replaces the codes of a request and of its history by plain words", () => {
    const found = {
      ok: true,
      value: {
        request: { reference: "REQ-0006", status: "NEW", priority: null, type: "FEATURE_REQUEST" },
        messageCount: 3,
        recentEvents: [{ type: "REVIEWED", at: "2026-10-30T08:00:00.000Z", by: "HUMAN" }],
      },
    };

    expect(explainForModel(found)).toEqual({
      ok: true,
      value: {
        request: {
          reference: "REQ-0006",
          status: "new: no one of the team has started on it yet",
          priority: "not set",
          type: "request for a new feature",
        },
        messageCount: 3,
        recentEvents: [
          {
            type: "checked by a person of the team",
            at: "2026-10-30T08:00:00.000Z",
            by: "a person of the team",
          },
        ],
      },
    });
  });

  it("explains every request of a list, and keeps errors as they are", () => {
    expect(
      explainForModel({ ok: true, value: [{ status: "RESOLVED", priority: "HIGH" }] }),
    ).toEqual({ ok: true, value: [{ status: "resolved by the team", priority: "high" }] });
    expect(explainForModel({ ok: false, error: "NOT_FOUND" })).toEqual({
      ok: false,
      error: "NOT_FOUND",
    });
  });
});
