import type { Run } from "./types";
import type { SaveOptions } from "../storage/types";
import { StorageConflictError } from "../storage/error";

export interface RunStore {
  save(run: Run, options?: SaveOptions): Promise<Run>;
  get(id: string): Promise<Run | undefined>;
}

export class InMemoryRunStore implements RunStore {
  private runs = new Map<string, Run>();

  async save(run: Run, options: SaveOptions = {}): Promise<Run> {
    const current = this.runs.get(run.id);
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
      throw new StorageConflictError("runs", run.id, options.expectedRevision, current?.revision);
    }
    const saved = { ...run, revision: (current?.revision ?? -1) + 1 };
    this.runs.set(run.id, saved);
    return saved;
  }

  async get(id: string): Promise<Run | undefined> {
    return this.runs.get(id);
  }
}
