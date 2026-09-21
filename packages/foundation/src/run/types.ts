import type { LunarEvent } from "../event";
import type { TraceSpan } from "./trace";
import type { Artifact } from "./artifact";

export type RunStatus = "pending" | "running" | "completed" | "failed";

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Run<Result = unknown> {
  id: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  events: LunarEvent[];
  trace: TraceSpan[];
  artifacts: Artifact[];
  usage: RunUsage;
  result?: Result;
  error?: string;
}
