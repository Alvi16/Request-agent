import { createMockModel } from "@mastra/core/test-utils/llm-mock";
import { describe, expect, it } from "vitest";

import { createRequestAgent } from "./request-agent";

describe("createRequestAgent", () => {
  it("answers with the text produced by its model", async () => {
    const agent = createRequestAgent(createMockModel({ mockText: "Bonjour", version: "v2" }));

    const result = await agent.generate("Bonjour");

    expect(agent.id).toBe("request-agent");
    expect(result.text).toBe("Bonjour");
  });
});
