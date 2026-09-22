import type { Agent, AgentRunOptions, AgentRunResult } from "../agent";
import type { Run } from "../run";
import type { Session, SessionStore } from "../session";
import type { EventName, EventHandler } from "../event";
import type { LunarEvent } from "../event";
import type { Plugin } from "../plugin";
import type { RunStore } from "../run";
import type { Workflow, WorkflowRun, WorkflowStore } from "../workflow";
import type { ObservabilityConfig } from "../observability";
import type { MemoryProvider } from "../memory";
import type { StorageBundle } from "../storage";

export interface SteeringResult {
  status: "accepted";
  sessionId: string;
  interruptedRunId: string;
  continuationRunId: string;
}

export interface RuntimeConfig {
  plugins?: Plugin[];
  memory?: MemoryProvider | MemoryProvider[];
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
  steer(sessionId: string, instruction: string): Promise<Session | SteeringResult>;
  approve(runId: string, approvalId: string): Promise<AgentRunResult>;
  reject(runId: string, approvalId: string): Promise<Run>;
  cancel(runId: string): Promise<Run | undefined>;
  getRun(runId: string): Run | undefined;
  getStoredRun(runId: string): Promise<Run | undefined>;
  getSession(sessionId: string): Promise<Session | undefined>;
  getMemoryProvider(id?: string): MemoryProvider | undefined;
  on(event: EventName, handler: EventHandler): () => void;
  registerAgent(agent: Agent): void;
  registerWorkflow(workflow: Workflow): void;
  runWorkflow(name: string, input?: unknown): Promise<WorkflowRun>;
  getWorkflowRun(id: string): Promise<WorkflowRun | undefined>;
  resumeWorkflow(id: string, approvalId?: string): Promise<WorkflowRun>;
  cancelWorkflow(id: string): Promise<WorkflowRun | undefined>;
  shutdown?(): Promise<void>;
}

export type RuntimeStreamEvent =
  | { type: "event"; event: LunarEvent }
  | { type: "text.delta"; runId: string; text: string }
  | { type: "stream.completed"; result: AgentRunResult }
  | { type: "stream.interrupted"; sessionId: string; interruptedRunId: string; continuationRunId: string }
  | { type: "stream.error"; error: string; runId?: string; code?: string };
