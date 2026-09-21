import type { WorkflowRun } from "./types";

export interface WorkflowStore {
  save(run: WorkflowRun): Promise<void>;
  get(id: string): Promise<WorkflowRun | undefined>;
}

export class InMemoryWorkflowStore implements WorkflowStore {
  private readonly runs = new Map<string, WorkflowRun>();

  async save(run: WorkflowRun): Promise<void> {
    this.runs.set(run.id, run);
  }

  async get(id: string): Promise<WorkflowRun | undefined> {
    return this.runs.get(id);
  }
}
