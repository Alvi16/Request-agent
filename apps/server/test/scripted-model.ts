import { MastraLanguageModelV2Mock } from "@mastra/core/test-utils/llm-mock";

type ToolCall = { tool: string; input: unknown };
// A step calls tools, possibly writing some text next to them as models do, or only writes text.
export type ScriptedStep = { toolCalls: ToolCall[]; text?: string } | { text: string };

const usage = { inputTokens: 1, outputTokens: 1, totalTokens: 2 };

function toResult(step: ScriptedStep, index: number) {
  if (!("toolCalls" in step)) {
    return {
      content: [{ type: "text" as const, text: step.text }],
      finishReason: "stop" as const,
      usage,
      warnings: [],
    };
  }
  const text = step.text === undefined ? [] : [{ type: "text" as const, text: step.text }];
  return {
    content: [
      ...text,
      ...step.toolCalls.map((call, position) => ({
        type: "tool-call" as const,
        toolCallId: `call-${index}-${position}`,
        toolName: call.tool,
        input: JSON.stringify(call.input),
      })),
    ],
    finishReason: "tool-calls" as const,
    usage,
    warnings: [],
  };
}

// A model that plays a fixed script, one step per call, so the tests control which tools it calls.
// After the script, it keeps repeating the last step.
export function scriptedModel(steps: ScriptedStep[]): MastraLanguageModelV2Mock {
  let call = 0;
  return new MastraLanguageModelV2Mock({
    doGenerate: () => {
      const index = Math.min(call, steps.length - 1);
      call += 1;
      const step = steps[index];
      if (step === undefined) {
        throw new Error("A scripted model needs at least one step");
      }
      return Promise.resolve(toResult(step, call));
    },
  });
}

// Names of the tools offered to the model at its first call.
export function offeredTools(model: MastraLanguageModelV2Mock): string[] {
  return (model.doGenerateCalls[0]?.tools ?? [])
    .map((tool) => tool.name)
    .toSorted((a, b) => a.localeCompare(b));
}
