import type { Run, RunUsage } from "./types";

export function addUsage<Result>(run: Run<Result>, delta: RunUsage): Run<Result> {
  return {
    ...run,
    usage: {
      inputTokens: run.usage.inputTokens + delta.inputTokens,
      outputTokens: run.usage.outputTokens + delta.outputTokens,
    },
  };
}
