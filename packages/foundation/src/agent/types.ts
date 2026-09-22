import type { ModelProvider } from "../model";
import type { Tool } from "../tool";
import type { ModelMessage } from "../model";
import type { RetryPolicy } from "./retry";
import type { EventBus } from "../event";
import type { Run, RunContinuation } from "../run";
import type { LunarEvent } from "../event";
import type { MemoryProvider } from "../memory";

export type AgentState = "idle" | "running" | "waiting" | "done" | "error";

export interface AgentMemoryConfig {
  providerId?: string;
  retrieveLimit?: number;
  store?: "none" | "conversation";
  namespace?: string;
  filter?: Record<string, unknown>;
}

export interface AgentConfig {
  name: string;
  model: ModelProvider;
  systemPrompt?: string;
  tools?: Tool<any, any>[];
  maxToolRoundtrips?: number;
  retryPolicy?: RetryPolicy;
  maxContextTokens?: number;
  memory?: boolean | AgentMemoryConfig;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  history?: ModelMessage[];
  sessionId?: string;
  tenantId?: string;
  ownerId?: string;
  eventBus?: EventBus;
  continuation?: RunContinuation;
  resumeRun?: Run<string>;
  initialRun?: Run<string>;
  approvedToolCallId?: string;
  streaming?: boolean;
  onEvent?: (event: LunarEvent) => void;
  onTextDelta?: (runId: string, text: string) => void;
  parentRunId?: string;
  onInterrupted?: (continuation: RunContinuation) => void;
  onSteered?: (event: { interruptedRunId: string; continuationRunId: string; sessionId: string }) => void;
  memoryProvider?: MemoryProvider;
}

export interface AgentRunResult {
  output: string;
  run: Run<string>;
}

export interface Agent {
  name: string;
  modelId?: string;
  supportsStreaming?: boolean;
  memory?: AgentMemoryConfig;
  run(input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
}
