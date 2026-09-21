import type { Run } from "./types";

export function compareRuns<Result>(a: Run<Result>, b: Run<Result>) {
  return {
    statusChanged: a.status !== b.status,
    usageDelta: {
      inputTokens: b.usage.inputTokens - a.usage.inputTokens,
      outputTokens: b.usage.outputTokens - a.usage.outputTokens,
    },
  };
}
