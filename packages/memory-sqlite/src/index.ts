import { Database } from "bun:sqlite";
import type { MemoryProvider, MemoryQuery, MemoryRecord } from "@lunar/foundation/memory";

const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS lunar_memories (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
    namespace TEXT,
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

  return {
    id: "sqlite",
    capabilities: { metadataFiltering: true, namespaces: true, deletion: true },
    database: opened.database,
    async store(record) {
      const stored: MemoryRecord = {
        ...record,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      opened.database
        .query("INSERT INTO lunar_memories (id, content, metadata, namespace, created_at) VALUES (?1, ?2, ?3, ?4, ?5)")
        .run(stored.id, stored.content, stored.metadata === undefined ? null : JSON.stringify(stored.metadata), stored.namespace ?? null, stored.createdAt);
      return stored;
    },
    async retrieve(query: MemoryQuery) {
      const limit = Math.max(0, Math.floor(query.limit ?? 10));
      if (limit === 0) return [];
      const rows = opened.database
        .query("SELECT id, content, metadata, namespace, created_at FROM lunar_memories WHERE content LIKE ?1 ESCAPE '\\' AND (?2 IS NULL OR namespace = ?2) ORDER BY rowid ASC")
        .all(`%${escapeLike(query.text)}%`, query.namespace ?? null) as Array<{
          id: string;
          content: string;
          metadata: string | null;
          namespace: string | null;
          created_at: number;
        }>;
      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as Record<string, unknown> }),
        ...(row.namespace === null ? {} : { namespace: row.namespace }),
        createdAt: row.created_at,
      })).filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value))
        .filter(() => query.minScore === undefined || query.minScore <= 1)
        .slice(0, limit);
    },
    async delete(id) {
      return opened.database.query("DELETE FROM lunar_memories WHERE id = ?1").run(id).changes > 0;
    },
    close() {
      if (opened.owned) opened.database.close();
    },
  };
}
