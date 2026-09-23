import { Database } from "bun:sqlite";
import type { MemoryProvider, MemoryQuery, MemoryRecord } from "@lunar/foundation/memory";

const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS lunar_memories (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    namespace TEXT,
    tenant_id TEXT,
    owner_id TEXT,
    expires_at INTEGER,
    embedding TEXT,
    created_at INTEGER NOT NULL
  )
`;

function openDatabase(database: string | Database): { database: Database; owned: boolean } {
  return typeof database === "string"
    ? { database: new Database(database), owned: true }
    : { database, owned: false };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

export interface SqliteMemoryProvider extends MemoryProvider {
  database: Database;
  close(): void;
}

export function createSqliteMemoryProvider(
  database: string | Database = "lunar-memory.db",
): SqliteMemoryProvider {
  const opened = openDatabase(database);
  opened.database.exec(MEMORY_SCHEMA);
  try {
    opened.database.exec("ALTER TABLE lunar_memories ADD COLUMN namespace TEXT");
  } catch (error) {
    if (!(error instanceof Error) || !error.message.toLowerCase().includes("duplicate column")) throw error;
  }
  for (const statement of [
    "ALTER TABLE lunar_memories ADD COLUMN tenant_id TEXT",
    "ALTER TABLE lunar_memories ADD COLUMN owner_id TEXT",
    "ALTER TABLE lunar_memories ADD COLUMN expires_at INTEGER",
    "ALTER TABLE lunar_memories ADD COLUMN embedding TEXT",
  ]) {
    try { opened.database.exec(statement); } catch (error) {
      if (!(error instanceof Error) || !error.message.toLowerCase().includes("duplicate column")) throw error;
    }
  }

  return {
    id: "sqlite",
    capabilities: { semanticSearch: true, metadataFiltering: true, namespaces: true, deletion: true },
    database: opened.database,
    async store(record) {
      const stored: MemoryRecord = {
        ...record,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      opened.database
        .query("INSERT INTO lunar_memories (id, content, metadata, namespace, tenant_id, owner_id, expires_at, embedding, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
        .run(stored.id, stored.content, stored.metadata === undefined ? null : JSON.stringify(stored.metadata), stored.namespace ?? null, stored.tenantId ?? null, stored.ownerId ?? null, stored.expiresAt ?? null, stored.embedding === undefined ? null : JSON.stringify(stored.embedding), stored.createdAt);
      return stored;
    },
    async retrieve(query: MemoryQuery) {
      const limit = Math.max(0, Math.floor(query.limit ?? 10));
      if (limit === 0) return [];
      const rows = opened.database
        .query("SELECT id, content, metadata, namespace, tenant_id, owner_id, expires_at, embedding, created_at FROM lunar_memories WHERE (?1 = 1 OR content LIKE ?2 ESCAPE '\\') AND (?3 IS NULL OR namespace = ?3) AND (?4 IS NULL OR tenant_id = ?4) AND (?5 IS NULL OR owner_id = ?5) AND (expires_at IS NULL OR expires_at > ?6) ORDER BY rowid ASC")
        .all(query.embedding === undefined ? 0 : 1, `%${escapeLike(query.text)}%`, query.namespace ?? null, query.tenantId ?? null, query.ownerId ?? null, Date.now()) as Array<{
          id: string;
          content: string;
          metadata: string | null;
          namespace: string | null;
          tenant_id: string | null;
          owner_id: string | null;
          expires_at: number | null;
          embedding: string | null;
          created_at: number;
        }>;
      const records: MemoryRecord[] = rows.map((row) => ({
        id: row.id,
        content: row.content,
        ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as Record<string, unknown> }),
        ...(row.namespace === null ? {} : { namespace: row.namespace }),
        ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }),
        ...(row.owner_id === null ? {} : { ownerId: row.owner_id }),
        ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }),
        ...(row.embedding === null ? {} : { embedding: JSON.parse(row.embedding) as number[] }),
        createdAt: row.created_at,
      })).filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value))
        .filter((record) => query.embedding === undefined || record.embedding !== undefined)
        .map((record): MemoryRecord => query.embedding && record.embedding ? { ...record, score: cosineSimilarity(query.embedding, record.embedding) } : record)
        .filter((record) => query.minScore === undefined || (record.score ?? 1) >= query.minScore);
      if (query.embedding !== undefined) records.sort((left, right) => (right.score ?? 0) - (left.score ?? 0));
      return records.slice(0, limit);
    },
    async list(query) {
      const limit = Math.max(1, Math.min(Math.floor(query.limit ?? 50), 100));
      const offset = query.cursor ? Math.max(0, Number(query.cursor)) : 0;
      const rows = opened.database.query("SELECT id, content, metadata, namespace, tenant_id, owner_id, expires_at, created_at FROM lunar_memories WHERE (?1 IS NULL OR namespace = ?1) AND (?2 IS NULL OR tenant_id = ?2) AND (?3 IS NULL OR owner_id = ?3) AND (expires_at IS NULL OR expires_at > ?4) ORDER BY rowid ASC LIMIT ?5 OFFSET ?6")
        .all(query.namespace ?? null, query.tenantId ?? null, query.ownerId ?? null, Date.now(), limit + 1, offset) as Array<{ id: string; content: string; metadata: string | null; namespace: string | null; tenant_id: string | null; owner_id: string | null; expires_at: number | null; created_at: number }>;
      const records = rows.slice(0, limit).map((row) => ({ id: row.id, content: row.content, ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as Record<string, unknown> }), ...(row.namespace === null ? {} : { namespace: row.namespace }), ...(row.tenant_id === null ? {} : { tenantId: row.tenant_id }), ...(row.owner_id === null ? {} : { ownerId: row.owner_id }), ...(row.expires_at === null ? {} : { expiresAt: row.expires_at }), createdAt: row.created_at }))
        .filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value));
      return { records, ...(rows.length > limit ? { nextCursor: String(offset + limit) } : {}) };
    },
    async delete(id, tenantId, ownerId) {
      return opened.database.query("DELETE FROM lunar_memories WHERE id = ?1 AND (?2 IS NULL OR tenant_id = ?2) AND (?3 IS NULL OR owner_id = ?3)").run(id, tenantId ?? null, ownerId ?? null).changes > 0;
    },
    close() {
      if (opened.owned) opened.database.close();
    },
  };
}
