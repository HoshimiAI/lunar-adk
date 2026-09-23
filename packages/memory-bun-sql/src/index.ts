import { SQL } from "bun";
import type { MemoryListQuery, MemoryPage, MemoryProvider, MemoryQuery, MemoryRecord } from "@lunar/foundation/memory";

export interface BunSqlMemoryOptions {
  connection: string | SQL;
  id?: string;
}

type Row = { id: string; content: string; metadata: Record<string, unknown> | null; embedding: number[] | null; namespace: string | null; tenant_id: string; owner_id: string | null; expires_at: Date | string; created_at: Date | string; score?: number };

function time(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function row(record: Row): MemoryRecord {
  return {
    id: record.id,
    content: record.content,
    ...(record.metadata ? { metadata: record.metadata } : {}),
    ...(record.embedding ? { embedding: record.embedding } : {}),
    ...(record.namespace ? { namespace: record.namespace } : {}),
    tenantId: record.tenant_id,
    ...(record.owner_id === null ? {} : { ownerId: record.owner_id }),
    expiresAt: time(record.expires_at),
    createdAt: time(record.created_at),
    ...(record.score === undefined ? {} : { score: Number(record.score) }),
  };
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) { dot += left[index]! * right[index]!; leftMagnitude += left[index]! ** 2; rightMagnitude += right[index]! ** 2; }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

function requireTenant(tenantId: string | undefined): string {
  if (!tenantId) throw new Error("PostgreSQL memory requires tenantId");
  return tenantId;
}

export interface BunSqlMemoryProvider extends MemoryProvider {
  client: SQL;
  close(): Promise<void>;
  health(): Promise<void>;
}

export async function createBunSqlMemoryProvider(options: BunSqlMemoryOptions): Promise<BunSqlMemoryProvider> {
  const client = typeof options.connection === "string" ? new SQL(options.connection) : options.connection;
  await client.unsafe(`
    CREATE TABLE IF NOT EXISTS lunar_memories (
      id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL,
      owner_id TEXT,
      namespace TEXT,
      content TEXT NOT NULL,
      metadata JSONB,
      embedding JSONB,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      search_document TSVECTOR GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED
    );
    ALTER TABLE lunar_memories ADD COLUMN IF NOT EXISTS embedding JSONB;
    ALTER TABLE lunar_memories ADD COLUMN IF NOT EXISTS owner_id TEXT;
    CREATE INDEX IF NOT EXISTS lunar_memories_search_idx ON lunar_memories USING GIN (search_document);
    CREATE INDEX IF NOT EXISTS lunar_memories_scope_idx ON lunar_memories (tenant_id, namespace, expires_at);
  `);
  const list = async (query: MemoryListQuery): Promise<MemoryPage> => {
    const tenantId = requireTenant(query.tenantId);
    const limit = Math.max(1, Math.min(Math.floor(query.limit ?? 50), 100));
    const offset = query.cursor ? Math.max(0, Number(query.cursor)) : 0;
    const rows = await client.unsafe(
      "SELECT id, content, metadata, embedding, namespace, tenant_id, owner_id, expires_at, created_at FROM lunar_memories WHERE tenant_id = $1 AND ($2::text IS NULL OR namespace = $2) AND ($3::text IS NULL OR owner_id = $3) AND expires_at > NOW() ORDER BY created_at DESC LIMIT $4 OFFSET $5",
      [tenantId, query.namespace ?? null, query.ownerId ?? null, limit + 1, offset],
    ) as Row[];
    const records = rows.slice(0, limit).map(row).filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value));
    return { records, ...(rows.length > limit ? { nextCursor: String(offset + limit) } : {}) };
  };
  return {
    id: options.id ?? "postgres",
    capabilities: { semanticSearch: true, metadataFiltering: true, namespaces: true, deletion: true },
    client,
    async store(input) {
      const tenantId = requireTenant(input.tenantId);
      if (!input.expiresAt || input.expiresAt <= Date.now()) throw new Error("Memory expiresAt must be in the future");
      const id = crypto.randomUUID();
      const createdAt = Date.now();
      await client.unsafe("INSERT INTO lunar_memories (id, tenant_id, owner_id, namespace, content, metadata, embedding, expires_at, created_at) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8, $9)", [id, tenantId, input.ownerId ?? null, input.namespace ?? null, input.content, input.metadata === undefined ? null : JSON.stringify(input.metadata), input.embedding === undefined ? null : JSON.stringify(input.embedding), new Date(input.expiresAt), new Date(createdAt)]);
      return { ...input, id, tenantId, createdAt };
    },
    async retrieve(query: MemoryQuery) {
      const tenantId = requireTenant(query.tenantId);
      const limit = Math.max(1, Math.min(Math.floor(query.limit ?? 10), 100));
      if (query.embedding) {
        const rows = await client.unsafe(
          "SELECT id, content, metadata, embedding, namespace, tenant_id, owner_id, expires_at, created_at FROM lunar_memories WHERE tenant_id = $1 AND ($2::text IS NULL OR namespace = $2) AND ($3::text IS NULL OR owner_id = $3) AND expires_at > NOW() AND embedding IS NOT NULL",
          [tenantId, query.namespace ?? null, query.ownerId ?? null],
        ) as Row[];
        return rows.map(row).map((record) => ({ ...record, score: cosineSimilarity(query.embedding!, record.embedding!) }))
          .filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value))
          .filter((record) => query.minScore === undefined || (record.score ?? 0) >= query.minScore)
          .sort((left, right) => (right.score ?? 0) - (left.score ?? 0)).slice(0, limit);
      }
      const rows = await client.unsafe(
        "SELECT id, content, metadata, embedding, namespace, tenant_id, owner_id, expires_at, created_at, ts_rank(search_document, websearch_to_tsquery('simple', $2)) AS score FROM lunar_memories WHERE tenant_id = $1 AND ($3::text IS NULL OR namespace = $3) AND ($4::text IS NULL OR owner_id = $4) AND expires_at > NOW() AND search_document @@ websearch_to_tsquery('simple', $2) ORDER BY score DESC, created_at DESC LIMIT $5",
        [tenantId, query.text, query.namespace ?? null, query.ownerId ?? null, limit],
      ) as Row[];
      return rows.map(row).filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value)).filter((record) => query.minScore === undefined || (record.score ?? 0) >= query.minScore);
    },
    list,
    async delete(id, tenantId, ownerId) {
      const tenant = requireTenant(tenantId);
      const result = await client.unsafe("DELETE FROM lunar_memories WHERE id = $1 AND tenant_id = $2 AND ($3::text IS NULL OR owner_id = $3) RETURNING id", [id, tenant, ownerId ?? null]) as Array<{ id: string }>;
      return result.length > 0;
    },
    async health() { await client.unsafe("SELECT 1"); },
    async close() { await client.close(); },
  };
}
