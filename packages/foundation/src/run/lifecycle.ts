import type { LunarEvent } from "../event";
import type { Run } from "./types";

export function createRun<Result = unknown>(metadata: Pick<Run<Result>, "agent" | "model" | "sessionId"> = {}): Run<Result> {
  return {
    id: crypto.randomUUID(),
    ...metadata,
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

export function appendEvent<Result>(run: Run<Result>, event: LunarEvent): Run<Result> {
  return { ...run, events: [...run.events, event] };
}
