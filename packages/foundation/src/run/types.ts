import type { LunarEvent } from "../event";
import type { TraceSpan } from "./trace";
import type { Artifact } from "./artifact";
import type { ModelMessage, ModelToolCall } from "../model";

export type RunStatus = "pending" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export interface RunUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface Run<Result = unknown> {
  id: string;
  revision?: number;
  agent?: string;
  model?: string;
  sessionId?: string;
  tenantId?: string;
  ownerId?: string;
  parentRunId?: string;
  status: RunStatus;
  startedAt: number;
  endedAt?: number;
  events: LunarEvent[];
  trace: TraceSpan[];
  artifacts: Artifact[];
  usage: RunUsage;
  result?: Result;
  error?: string;
  errorCode?: string;
  pendingApproval?: PendingApproval;
  continuation?: RunContinuation;
}

export interface PendingApproval {
  id: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
  requestedAt: number;
}

export interface RunContinuation {
  input: string;
  messages: ModelMessage[];
  round: number;
  toolCalls: ModelToolCall[];
  nextToolIndex: number;
}
