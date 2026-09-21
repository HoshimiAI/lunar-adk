import type { MemoryRecord } from "./types";

export interface MemoryStore {
  save(record: MemoryRecord): Promise<void>;
  query(text: string, limit?: number): Promise<MemoryRecord[]>;
}
