import type { LunarEvent } from "../event";
import type { PendingApproval, Run, RunContinuation } from "./types";

export function createRun<Result = unknown>(metadata: Pick<Run<Result>, "agent" | "model" | "sessionId" | "parentRunId" | "tenantId" | "ownerId"> = {}): Run<Result> {
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
  const { pendingApproval: _pendingApproval, continuation: _continuation, ...completed } = run;
  return { ...completed, status: "completed", endedAt: Date.now(), result };
}

export function failRun<Result>(run: Run<Result>, error: string, errorCode?: string): Run<Result> {
  const { pendingApproval: _pendingApproval, continuation: _continuation, ...failed } = run;
  return { ...failed, status: "failed", endedAt: Date.now(), error, errorCode };
}

export function cancelRun<Result>(run: Run<Result>, error = "The operation was aborted"): Run<Result> {
  const { pendingApproval: _pendingApproval, continuation: _continuation, ...cancelled } = run;
  return { ...cancelled, status: "cancelled", endedAt: Date.now(), error, errorCode: "CANCELLED" };
}

export function pauseRun<Result>(run: Run<Result>, approval: PendingApproval, continuation: RunContinuation): Run<Result> {
  return { ...run, status: "waiting_approval", pendingApproval: approval, continuation };
}

export function appendEvent<Result>(run: Run<Result>, event: LunarEvent): Run<Result> {
  return { ...run, events: [...run.events, event] };
}
