import type { Run } from "./types";

export function inspectRun<Result>(run: Run<Result>) {
  return {
    id: run.id,
    status: run.status,
    durationMs: (run.endedAt ?? Date.now()) - run.startedAt,
    eventCount: run.events.length,
    toolCallCount: run.trace.length,
  };
}
