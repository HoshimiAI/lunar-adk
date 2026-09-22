import type { Agent, AgentRunResult } from "../agent";
import type { WorkflowStore } from "./store";

export type WorkflowStatus = "pending" | "running" | "waiting_approval" | "completed" | "failed" | "cancelled";

export interface WorkflowCheckpoint {
  name: string;
  state: Record<string, unknown>;
  createdAt: number;
}

export interface WorkflowApproval {
  id: string;
  message: string;
  requestedAt: number;
}

export interface WorkflowRun {
  id: string;
  revision?: number;
  tenantId?: string;
  workflow: string;
  version: string;
  status: WorkflowStatus;
  input: unknown;
  state: Record<string, unknown>;
  checkpoints: WorkflowCheckpoint[];
  childRunIds: string[];
  startedAt: number;
  endedAt?: number;
  output?: unknown;
  error?: string;
  pendingApproval?: WorkflowApproval;
  approvedApprovalIds: string[];
}

export interface WorkflowRunOptions {
  tenantId?: string;
}

export interface WorkflowContext {
  readonly input: unknown;
  readonly state: Record<string, unknown>;
  readonly signal: AbortSignal;
  readonly run: WorkflowRun;
  readonly resumeFrom?: WorkflowCheckpoint;
  checkpoint(name: string, state?: Record<string, unknown>): Promise<WorkflowCheckpoint>;
  requestApproval(id: string, message: string): Promise<void>;
  runSubAgent(agent: string | Agent, input: string, options?: { sessionId?: string }): Promise<AgentRunResult>;
  parallel<T>(tasks: Array<() => Promise<T>>): Promise<T[]>;
}

export type WorkflowStep =
  | { kind: "sequential"; steps: WorkflowStep[] }
  | { kind: "parallel"; steps: WorkflowStep[] }
  | { kind: "conditional"; condition: (context: unknown) => boolean; ifTrue: WorkflowStep; ifFalse?: WorkflowStep }
  | { kind: "approval"; message: string; next: WorkflowStep }
  | { kind: "agent"; agent: Agent; input: string };

export interface WorkflowConfig {
  name: string;
  version?: string;
  run?: (ctx: WorkflowContext) => Promise<unknown>;
  root?: WorkflowStep;
}

export interface Workflow {
  name: string;
  version: string;
  run(ctx: WorkflowContext): Promise<unknown>;
}

export interface WorkflowRuntimeConfig {
  workflowStore?: WorkflowStore;
}

export class WorkflowApprovalRequired extends Error {
  constructor(readonly approval: WorkflowApproval) {
    super(`Workflow approval required: ${approval.message}`);
    this.name = "WorkflowApprovalRequired";
  }
}
