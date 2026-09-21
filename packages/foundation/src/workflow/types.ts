import type { Agent } from "../agent";

export type WorkflowStep =
  | { kind: "sequential"; steps: WorkflowStep[] }
  | { kind: "parallel"; steps: WorkflowStep[] }
  | { kind: "conditional"; condition: (context: unknown) => boolean; ifTrue: WorkflowStep; ifFalse?: WorkflowStep }
  | { kind: "approval"; message: string; next: WorkflowStep }
  | { kind: "agent"; agent: Agent; input: string };

export interface WorkflowConfig {
  name: string;
  root: WorkflowStep;
}

export interface Workflow {
  name: string;
  run(): Promise<unknown>;
}
