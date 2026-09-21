import type { Run } from "./types";

export interface RunStore {
  save(run: Run): Promise<void>;
  get(id: string): Promise<Run | undefined>;
}

export class InMemoryRunStore implements RunStore {
  private runs = new Map<string, Run>();

  async save(run: Run): Promise<void> {
    this.runs.set(run.id, run);
  }

  async get(id: string): Promise<Run | undefined> {
    return this.runs.get(id);
  }
}
