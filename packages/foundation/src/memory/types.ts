export interface MemoryRecord {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  createdAt: number;
}

export interface MemoryQuery {
  text: string;
  limit?: number;
}

export interface MemoryProvider {
  id: string;
  store(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord>;
  retrieve(query: MemoryQuery): Promise<MemoryRecord[]>;
}
