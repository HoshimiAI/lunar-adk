export interface MemoryRecord {
  id: string;
  content: string;
  metadata?: Record<string, unknown>;
  namespace?: string;
  tenantId?: string;
  expiresAt?: number;
  score?: number;
  createdAt: number;
}

export interface MemoryQuery {
  text: string;
  limit?: number;
  namespace?: string;
  filter?: Record<string, unknown>;
  minScore?: number;
  tenantId?: string;
}

export interface MemoryListQuery {
  tenantId?: string;
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
  delete?(id: string, tenantId?: string): Promise<boolean>;
  close?(): void | Promise<void>;
}
