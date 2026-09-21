import type { ModelProvider } from "../model";
import type { Tool } from "../tool";
import type { ModelMessage } from "../model";
import type { RetryPolicy } from "./retry";
import type { EventBus } from "../event";
import type { Run, RunContinuation } from "../run";

export type AgentState = "idle" | "running" | "waiting" | "done" | "error";

export interface AgentConfig {
  name: string;
  model: ModelProvider;
  systemPrompt?: string;
  tools?: Tool<any, any>[];
  maxToolRoundtrips?: number;
  retryPolicy?: RetryPolicy;
  maxContextTokens?: number;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  history?: ModelMessage[];
  sessionId?: string;
  eventBus?: EventBus;
  continuation?: RunContinuation;
  resumeRun?: Run<string>;
  initialRun?: Run<string>;
  approvedToolCallId?: string;
}

export interface AgentRunResult {
  output: string;
  run: Run<string>;
}

export interface Agent {
  name: string;
  modelId?: string;
  run(input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
}
