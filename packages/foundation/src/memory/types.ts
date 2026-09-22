export interface MemoryRecord {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  namespace?: string;
  tenantId?: string;
  ownerId?: string;
  expiresAt?: number;
  score?: number;
  /** Optional vector used for semantic retrieval. */
  embedding?: number[];
  createdAt: number;
}

export interface MemoryQuery {
  text: string;
  limit?: number;
  namespace?: string;
  filter?: Record<string, unknown>;
  minScore?: number;
  tenantId?: string;
  ownerId?: string;
  embedding?: number[];
}

export interface EmbeddingProvider {
  readonly id: string;
  embed(input: string): Promise<number[]>;
}

export interface MemoryListQuery {
  tenantId?: string;
  ownerId?: string;
  namespace?: string;
  filter?: Record<string, unknown>;
  limit?: number;
  cursor?: string;
}

export interface MemoryPage {
  records: MemoryRecord[];
  nextCursor?: string;
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
  list?(query: MemoryListQuery): Promise<MemoryPage>;
  delete?(id: string, tenantId?: string, ownerId?: string): Promise<boolean>;
  close?(): void | Promise<void>;
}
