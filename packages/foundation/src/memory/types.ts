export interface MemoryRecord {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  namespace?: string;
  score?: number;
  createdAt: number;
}

export interface MemoryQuery {
  text: string;
  limit?: number;
  namespace?: string;
  filter?: Record<string, unknown>;
  minScore?: number;
}

export interface MemoryCapabilities {
  semanticSearch?: boolean;
  metadataFiltering?: boolean;
  namespaces?: boolean;
  deletion?: boolean;
}

export interface MemoryProvider {
  readonly id: string;
  readonly capabilities?: MemoryCapabilities;
  store(record: Omit<MemoryRecord, "id" | "createdAt">): Promise<MemoryRecord>;
  retrieve(query: MemoryQuery): Promise<MemoryRecord[]>;
  delete?(id: string): Promise<boolean>;
  close?(): void | Promise<void>;
}
