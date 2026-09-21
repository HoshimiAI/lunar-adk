import { Database } from "bun:sqlite";
import type { Run, RunStore, Session, SessionStore } from "@lunar/foundation";

export const SQLITE_SCHEMA_VERSION = 1;

function openDatabase(database: string | Database): Database {
  return typeof database === "string" ? new Database(database) : database;
}

function initialize(database: Database): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS lunar_schema (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      version INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lunar_runs (
      id TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS lunar_sessions (
      id TEXT PRIMARY KEY NOT NULL,
      value TEXT NOT NULL
    );
  `);
  database
    .query("INSERT OR IGNORE INTO lunar_schema (id, version) VALUES (1, ?1)")
    .run(SQLITE_SCHEMA_VERSION);
  const schema = database.query("SELECT version FROM lunar_schema WHERE id = 1").get() as
    | { version: number }
    | null;
  if (schema?.version !== SQLITE_SCHEMA_VERSION) {
    throw new Error(`Unsupported SQLite schema version: ${schema?.version ?? "missing"}`);
  }
}

export class SqliteRunStore implements RunStore {
  constructor(readonly database: Database) {
    initialize(database);
  }

  async save(run: Run): Promise<void> {
    this.database
      .query("INSERT INTO lunar_runs (id, value) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
      .run(run.id, JSON.stringify(run));
  }

  async get(id: string): Promise<Run | undefined> {
    const row = this.database.query("SELECT value FROM lunar_runs WHERE id = ?1").get(id) as
      | { value: string }
      | null;
    return row ? (JSON.parse(row.value) as Run) : undefined;
  }
}

export class SqliteSessionStore implements SessionStore {
  constructor(readonly database: Database) {
    initialize(database);
  }

  async save(session: Session): Promise<void> {
    this.database
      .query("INSERT INTO lunar_sessions (id, value) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
      .run(session.id, JSON.stringify(session));
  }

  async get(id: string): Promise<Session | undefined> {
    const row = this.database.query("SELECT value FROM lunar_sessions WHERE id = ?1").get(id) as
      | { value: string }
      | null;
    return row ? (JSON.parse(row.value) as Session) : undefined;
  }
}

export interface SqliteStores {
  database: Database;
  runStore: SqliteRunStore;
  sessionStore: SqliteSessionStore;
  close(): void;
}

export function createSqliteStores(database: string | Database = "lunar.db"): SqliteStores {
  const opened = openDatabase(database);
  return {
    database: opened,
    runStore: new SqliteRunStore(opened),
    sessionStore: new SqliteSessionStore(opened),
    close: () => opened.close(),
  };
}
