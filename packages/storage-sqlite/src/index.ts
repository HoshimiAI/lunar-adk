import { Database } from "bun:sqlite";
import type { Run, RunStore, Session, SessionStore, StorageBundle, WorkflowRun, WorkflowStore } from "@lunar/foundation";

export const SQLITE_SCHEMA_VERSION = 2;

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
    CREATE TABLE IF NOT EXISTS lunar_workflow_runs (
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
  if (schema?.version === 1) {
    database.query("UPDATE lunar_schema SET version = ?1 WHERE id = 1").run(SQLITE_SCHEMA_VERSION);
  } else if (schema?.version !== SQLITE_SCHEMA_VERSION) {
    throw new Error(`Unsupported SQLite schema version: ${schema?.version ?? "missing"}`);
  }
}

export class SqliteWorkflowStore implements WorkflowStore {
  constructor(readonly database: Database) {
    initialize(database);
  }

  async save(run: WorkflowRun): Promise<void> {
    this.database
      .query("INSERT INTO lunar_workflow_runs (id, value) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
      .run(run.id, JSON.stringify(run));
  }

  async get(id: string): Promise<WorkflowRun | undefined> {
    const row = this.database.query("SELECT value FROM lunar_workflow_runs WHERE id = ?1").get(id) as
      | { value: string }
      | null;
    return row ? (JSON.parse(row.value) as WorkflowRun) : undefined;
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

export interface SqliteStores extends StorageBundle {
  database: Database;
  runStore: SqliteRunStore;
  sessionStore: SqliteSessionStore;
  workflowStore: SqliteWorkflowStore;
  close(): void;
}

export function createSqliteStores(database: string | Database = "lunar.db"): SqliteStores {
  const opened = openDatabase(database);
  return {
    database: opened,
    runStore: new SqliteRunStore(opened),
    sessionStore: new SqliteSessionStore(opened),
    workflowStore: new SqliteWorkflowStore(opened),
    close: () => opened.close(),
  };
}
