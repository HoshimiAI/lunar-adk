import type { WorkflowRun } from "./types";
import type { SaveOptions } from "../storage/types";
import { StorageConflictError } from "../storage/error";

export interface WorkflowStore {
  save(run: WorkflowRun, options?: SaveOptions): Promise<WorkflowRun>;
  get(id: string): Promise<WorkflowRun | undefined>;
}

export class InMemoryWorkflowStore implements WorkflowStore {
  private readonly runs = new Map<string, WorkflowRun>();

  async save(run: WorkflowRun, options: SaveOptions = {}): Promise<WorkflowRun> {
    const current = this.runs.get(run.id);
    if (options.expectedRevision === undefined && current) {
      throw new StorageConflictError("workflow-runs", run.id, undefined, current.revision);
    }
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
      throw new StorageConflictError("workflow-runs", run.id, options.expectedRevision, current?.revision);
    }
    const saved = { ...run, revision: (current?.revision ?? -1) + 1 };
    this.runs.set(run.id, saved);
    return saved;
  }

  async get(id: string): Promise<WorkflowRun | undefined> {
    return this.runs.get(id);
  }
}
