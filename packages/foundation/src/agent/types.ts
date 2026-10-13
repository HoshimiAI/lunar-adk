import type { ModelProvider } from "../model";
import type { Tool } from "../tool";
import type { ModelMessage } from "../model";
import type { RetryPolicy } from "./retry";
import type { EventBus } from "../event";
import type { Run, RunContinuation } from "../run";
import type { LunarEvent } from "../event";
import type { MemoryProvider } from "../memory";
import type { PolicyEnforcer } from "../policy";
import type { RetrievedContextAttribution } from "../context";
import type { ModelCallOptions, ModelResponse, ModelToolCall } from "../model";
import type { ToolResult } from "../tool";
import type { AuthPrincipal } from "../auth";
import type { ToolCredentialProvider } from "../tool";

/** Read-only lifecycle callbacks for observing agent execution. Throwing from a hook fails the run. */
export interface AgentHooks {
  beforeModel?(context: { agent: string; runId: string; round: number; options: Readonly<ModelCallOptions> }): void | Promise<void>;
  afterModel?(context: { agent: string; runId: string; round: number; response: Readonly<ModelResponse> }): void | Promise<void>;
  beforeTool?(context: { agent: string; runId: string; toolCall: Readonly<ModelToolCall> }): void | Promise<void>;
  afterTool?(context: { agent: string; runId: string; toolCall: Readonly<ModelToolCall>; result: Readonly<ToolResult> }): void | Promise<void>;
}

export type AgentState = "idle" | "running" | "waiting" | "done" | "error";

export interface AgentMemoryConfig {
  providerId?: string;
  retrieveLimit?: number;
  store?: "none" | "conversation";
  namespace?: string;
  filter?: Record<string, unknown>;
}

export interface AgentContextConfig {
  providerId?: string;
  retrieveLimit?: number;
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
  /** Opt into source-aware knowledge retrieval registered on the runtime. */
  context?: boolean | AgentContextConfig;
  hooks?: AgentHooks;
}

export interface AgentRunOptions {
  signal?: AbortSignal;
  history?: ModelMessage[];
  sessionId?: string;
  tenantId?: string;
  workspaceId?: string;
  ownerId?: string;
  /** Identity derived from host-verified authentication; used only for this execution, never persisted. */
  principal?: AuthPrincipal;
  /** @internal Injected by RuntimeConfig; callers should configure credentials on the runtime. */
  toolCredentialProvider?: ToolCredentialProvider;
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
  /** Runtime supplied attribution for context already injected into this run. */
  retrievedContext?: RetrievedContextAttribution;
  /** Internal runtime policy hook applied before agent and tool execution. */
  policy?: PolicyEnforcer;
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
  context?: AgentContextConfig;
  run(input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
}
