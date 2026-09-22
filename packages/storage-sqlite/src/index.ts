import { Database } from "bun:sqlite";
import { StorageConflictError, type Run, type RunStore, type Session, type SessionStore, type StorageBundle, type WorkflowRun, type WorkflowStore, type SaveOptions } from "@lunar/foundation";

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

function saveRecord<T extends { id: string; revision?: number }>(
  database: Database,
  table: "lunar_runs" | "lunar_sessions" | "lunar_workflow_runs",
  resource: string,
  value: T,
  options: SaveOptions,
): T {
  const transaction = (database as Database & {
    transaction<Result>(callback: () => Result): () => Result;
  }).transaction(() => {
    const row = database.query(`SELECT value FROM ${table} WHERE id = ?1`).get(value.id) as { value: string } | null;
    const current = row ? JSON.parse(row.value) as T : undefined;
    if (options.expectedRevision === undefined && current) {
      throw new StorageConflictError(resource, value.id, undefined, current.revision);
    }
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
      throw new StorageConflictError(resource, value.id, options.expectedRevision, current?.revision);
    }
    const saved = { ...value, revision: (current?.revision ?? -1) + 1 };
    database.query(`INSERT INTO ${table} (id, value) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET value = excluded.value`)
      .run(saved.id, JSON.stringify(saved));
    return saved;
  });
  return transaction();
}

export class SqliteWorkflowStore implements WorkflowStore {
  constructor(readonly database: Database) {
    initialize(database);
  }

  async save(run: WorkflowRun, options: SaveOptions = {}): Promise<WorkflowRun> {
    return saveRecord(this.database, "lunar_workflow_runs", "workflow-runs", run, options);
  }

  async get(id: string): Promise<WorkflowRun | undefined> {
    const row = this.database.query("SELECT value FROM lunar_workflow_runs WHERE id = ?1").get(id) as
      | { value: string }
      | null;
    return row ? (JSON.parse(row.value) as WorkflowRun) : undefined;
  }

  async listRecoverable(): Promise<WorkflowRun[]> {
    const rows = this.database.query("SELECT value FROM lunar_workflow_runs").all() as { value: string }[];
    return rows.map(({ value }) => JSON.parse(value) as WorkflowRun).filter((run) => run.status === "running");
  }
}

export class SqliteRunStore implements RunStore {
  constructor(readonly database: Database) {
    initialize(database);
  }

  async save(run: Run, options: SaveOptions = {}): Promise<Run> {
    return saveRecord(this.database, "lunar_runs", "runs", run, options);
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

  async save(session: Session, options: SaveOptions = {}): Promise<Session> {
    return saveRecord(this.database, "lunar_sessions", "sessions", session, options);
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
  const saveRunAndSession = (run: Run, session: Session, options: SaveOptions = {}) => {
    let savedRun: Run | undefined;
    let savedSession: Session | undefined;
    const transaction = (opened as Database & {
      transaction(callback: () => void): () => void;
    }).transaction(() => {
      const runRow = opened.query("SELECT value FROM lunar_runs WHERE id = ?1").get(run.id) as { value: string } | null;
      const sessionRow = opened.query("SELECT value FROM lunar_sessions WHERE id = ?1").get(session.id) as { value: string } | null;
      const currentRun = runRow ? JSON.parse(runRow.value) as Run : undefined;
      const currentSession = sessionRow ? JSON.parse(sessionRow.value) as Session : undefined;
      if (options.expectedRevision === undefined && currentRun) {
        throw new StorageConflictError("runs", run.id, undefined, currentRun.revision);
      }
      if (options.expectedSessionRevision === undefined && currentSession) {
        throw new StorageConflictError("sessions", session.id, undefined, currentSession.revision);
      }
      if (options.expectedRevision !== undefined && (currentRun?.revision ?? 0) !== options.expectedRevision) {
        throw new StorageConflictError("runs", run.id, options.expectedRevision, currentRun?.revision);
      }
      if (options.expectedSessionRevision !== undefined && (currentSession?.revision ?? 0) !== options.expectedSessionRevision) {
        throw new StorageConflictError("sessions", session.id, options.expectedSessionRevision, currentSession?.revision);
      }
      savedRun = { ...run, revision: (currentRun?.revision ?? -1) + 1 };
      savedSession = { ...session, revision: (currentSession?.revision ?? -1) + 1 };
      opened.query("INSERT INTO lunar_runs (id, value) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
        .run(savedRun.id, JSON.stringify(savedRun));
      opened.query("INSERT INTO lunar_sessions (id, value) VALUES (?1, ?2) ON CONFLICT(id) DO UPDATE SET value = excluded.value")
        .run(savedSession.id, JSON.stringify(savedSession));
    });
    transaction();
    return Promise.resolve({ run: savedRun!, session: savedSession! });
  };
  return {
    capabilities: { optimisticConcurrency: true, atomicRunSession: true },
    database: opened,
    runStore: new SqliteRunStore(opened),
    sessionStore: new SqliteSessionStore(opened),
    workflowStore: new SqliteWorkflowStore(opened),
    saveRunAndSession,
    close: () => opened.close(),
  };
}
