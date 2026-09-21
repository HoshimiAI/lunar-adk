import type { Run } from "./types";

export function createRun<Result = unknown>(): Run<Result> {
  return {
    id: crypto.randomUUID(),
    status: "pending",
    startedAt: Date.now(),
    events: [],
    trace: [],
    artifacts: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
}

export function startRun<Result>(run: Run<Result>): Run<Result> {
  return { ...run, status: "running" };
}

export function completeRun<Result>(run: Run<Result>, result: Result): Run<Result> {
  return { ...run, status: "completed", endedAt: Date.now(), result };
}

export function failRun<Result>(run: Run<Result>, error: string): Run<Result> {
  return { ...run, status: "failed", endedAt: Date.now(), error };
}
