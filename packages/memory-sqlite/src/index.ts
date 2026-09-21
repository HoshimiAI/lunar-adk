import { Database } from "bun:sqlite";
import type { MemoryProvider, MemoryQuery, MemoryRecord } from "@lunar/foundation/memory";

const MEMORY_SCHEMA = `
  CREATE TABLE IF NOT EXISTS lunar_memories (
    id TEXT PRIMARY KEY NOT NULL,
    content TEXT NOT NULL,
    metadata TEXT,
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

  return {
    id: "sqlite",
    database: opened.database,
    async store(record) {
      const stored: MemoryRecord = {
        ...record,
        id: crypto.randomUUID(),
        createdAt: Date.now(),
      };
      opened.database
        .query("INSERT INTO lunar_memories (id, content, metadata, created_at) VALUES (?1, ?2, ?3, ?4)")
        .run(stored.id, stored.content, stored.metadata === undefined ? null : JSON.stringify(stored.metadata), stored.createdAt);
      return stored;
    },
    async retrieve(query: MemoryQuery) {
      const limit = Math.max(0, Math.floor(query.limit ?? 10));
      if (limit === 0) return [];
      const rows = opened.database
        .query("SELECT id, content, metadata, created_at FROM lunar_memories WHERE content LIKE ?1 ESCAPE '\\' ORDER BY rowid ASC LIMIT ?2")
        .all(`%${escapeLike(query.text)}%`, limit) as Array<{
          id: string;
          content: string;
          metadata: string | null;
          created_at: number;
        }>;
      return rows.map((row) => ({
        id: row.id,
        content: row.content,
        ...(row.metadata === null ? {} : { metadata: JSON.parse(row.metadata) as Record<string, unknown> }),
        createdAt: row.created_at,
      }));
    },
    close() {
      if (opened.owned) opened.database.close();
    },
  };
}
