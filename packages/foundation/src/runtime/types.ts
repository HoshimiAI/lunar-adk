import type { Agent, AgentRunOptions, AgentRunResult } from "../agent";
import type { Run } from "../run";
import type { Session, SessionStore } from "../session";
import type { EventName, EventHandler } from "../event";
import type { LunarEvent } from "../event";
import type { Plugin, PluginInfo } from "../plugin";
import type { RunStore } from "../run";
import type { Workflow, WorkflowRun, WorkflowStore, WorkflowRunOptions } from "../workflow";
import type { ObservabilityConfig } from "../observability";
import type { EmbeddingProvider, MemoryProvider } from "../memory";
import type { ContextProvider } from "../context";
import type { StorageBundle } from "../storage";
import type { StorageScope } from "../storage";
import type { PolicyRule } from "../policy";
import type { ToolCredentialProvider } from "../tool";

export interface SteeringResult {
  status: "accepted";
  sessionId: string;
  interruptedRunId: string;
  continuationRunId: string;
}

export interface RuntimeConfig {
  /** Ordered, first-match-wins rules for runtime agent, workflow, and tool execution. */
  policyRules?: PolicyRule[];
  plugins?: Plugin[];
  memory?: MemoryProvider | MemoryProvider[];
  context?: ContextProvider | ContextProvider[];
  /** Host-owned vault or OAuth adapter used to resolve short-lived tool credentials. */
  toolCredentials?: ToolCredentialProvider;
  embedding?: EmbeddingProvider;
  ownsMemory?: boolean;
  runStore?: RunStore;
  sessionStore?: SessionStore;
  workflowStore?: WorkflowStore;
  storage?: StorageBundle;
  ownsStorage?: boolean;
  observability?: ObservabilityConfig;
}

export interface RuntimeHandle {
  run(agentName: string, input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
  supportsStreaming(agentName: string): boolean;
  stream(agentName: string, input: string, options?: AgentRunOptions): AsyncIterable<RuntimeStreamEvent>;
  steer(sessionId: string, instruction: string, scope?: StorageScope): Promise<Session | SteeringResult>;
  approve(runId: string, approvalId: string, scope?: StorageScope, principal?: import("../auth").AuthPrincipal): Promise<AgentRunResult>;
  reject(runId: string, approvalId: string, scope?: StorageScope): Promise<Run>;
  cancel(runId: string, scope?: StorageScope): Promise<Run | undefined>;
  getRun(runId: string): Run | undefined;
  getActiveRunForSession(sessionId: string): Run | undefined;
  getStoredRun(runId: string, scope?: StorageScope): Promise<Run | undefined>;
  getSession(sessionId: string, scope?: StorageScope): Promise<Session | undefined>;
  renameSession(sessionId: string, title: string, scope?: StorageScope): Promise<Session | undefined>;
  forkSession(sessionId: string, scope?: StorageScope, ownerId?: string): Promise<Session | undefined>;
  getMemoryProvider(id?: string): MemoryProvider | undefined;
  listPlugins(): readonly PluginInfo[];
  on(event: EventName, handler: EventHandler): () => void;
  registerAgent(agent: Agent): void;
  registerWorkflow(workflow: Workflow): void;
  runWorkflow(name: string, input?: unknown, options?: WorkflowRunOptions): Promise<WorkflowRun>;
  recoverWorkflows(scope?: StorageScope): Promise<WorkflowRun[]>;
  getWorkflowRun(id: string, scope?: StorageScope): Promise<WorkflowRun | undefined>;
  resumeWorkflow(id: string, approvalId?: string, scope?: StorageScope, principal?: import("../auth").AuthPrincipal): Promise<WorkflowRun>;
  cancelWorkflow(id: string, scope?: StorageScope): Promise<WorkflowRun | undefined>;
  shutdown?(): Promise<void>;
}

export type RuntimeStreamEvent =
  | { type: "event"; event: LunarEvent }
  | { type: "text.delta"; runId: string; text: string }
  | { type: "stream.completed"; result: AgentRunResult }
  | { type: "stream.interrupted"; sessionId: string; interruptedRunId: string; continuationRunId: string }
  | { type: "stream.error"; error: string; runId?: string; code?: string };
