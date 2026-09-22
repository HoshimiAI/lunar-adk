import { SQL } from "bun";
import { StorageConflictError, type Run, type RunStore, type Session, type SessionStore, type StorageBundle, type WorkflowRun, type WorkflowStore, type SaveOptions } from "@lunar/foundation";

export type BunSqlDialect = "postgres" | "mysql" | "sqlite";

export interface BunSqlStorageOptions {
  connection: string | SQL;
  dialect?: BunSqlDialect;
}

type StoredRecord = { id: string; revision?: number };

function inferDialect(connection: string): BunSqlDialect {
  const value = connection.toLowerCase();
  if (value.startsWith("mysql://") || value.startsWith("mysql2://") || value.startsWith("mariadb://")) return "mysql";
  if (value.startsWith("sqlite:") || value.startsWith("file:") || value === ":memory:" || value.endsWith(".db")) return "sqlite";
  return "postgres";
}

function quoteTable(resource: string): string {
  if (!/^[a-z-]+$/.test(resource)) throw new Error(`Invalid storage resource: ${resource}`);
  return `lunar_${resource.replaceAll("-", "_")}`;
}

class TransactionQueue {
  private tail: Promise<void> = Promise.resolve();

  async run<Result>(operation: () => Promise<Result>): Promise<Result> {
    const previous = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => { release = resolve; });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

class BunSqlStore<T extends StoredRecord> {
  constructor(
    private readonly client: SQL,
    private readonly dialect: BunSqlDialect,
    private readonly resource: string,
    private readonly transactionQueue?: TransactionQueue,
  ) {}

  async save(value: T, options: SaveOptions = {}): Promise<T> {
    const operation = () => this.saveInTransaction(value, options);
    return this.transactionQueue ? this.transactionQueue.run(operation) : operation();
  }

  private async saveInTransaction(value: T, options: SaveOptions): Promise<T> {
    try {
      return await this.client.begin(async (transaction) => {
        const tx = transaction as SQL;
        const current = await this.getUsing(tx, value.id, this.dialect !== "sqlite");
        const currentRevision = current?.revision;
        if (options.expectedRevision === undefined && current) {
          throw new StorageConflictError(this.resource, value.id, undefined, currentRevision);
        }
        if (options.expectedRevision !== undefined && (currentRevision ?? 0) !== options.expectedRevision) {
          throw new StorageConflictError(this.resource, value.id, options.expectedRevision, currentRevision);
        }
        const saved = { ...value, revision: (currentRevision ?? -1) + 1 } as T;
        const table = quoteTable(this.resource);
        if (!current) {
          const statement = this.dialect === "mysql"
            ? `INSERT INTO ${table} (id, value) VALUES (?, ?)`
            : `INSERT INTO ${table} (id, value) VALUES ($1, $2)`;
          await tx.unsafe(statement, [saved.id, JSON.stringify(saved)]);
        } else {
          const statement = this.dialect === "mysql"
            ? `UPDATE ${table} SET value = ? WHERE id = ?`
            : `UPDATE ${table} SET value = $1 WHERE id = $2`;
          await tx.unsafe(statement, [JSON.stringify(saved), saved.id]);
        }
        return saved;
      }) as T;
    } catch (error) {
      const message = error instanceof Error ? error.message.toLowerCase() : "";
      if (options.expectedRevision === undefined && (message.includes("unique") || message.includes("duplicate"))) {
        const current = await this.get(value.id);
        throw new StorageConflictError(this.resource, value.id, undefined, current?.revision);
      }
      throw error;
    }
  }

  async get(id: string): Promise<T | undefined> {
    return this.getUsing(this.client, id, false);
  }

  private async getUsing(client: SQL, id: string, forUpdate: boolean): Promise<T | undefined> {
    const table = quoteTable(this.resource);
    const lock = forUpdate ? " FOR UPDATE" : "";
    const rows = this.dialect === "mysql"
      ? await client.unsafe(`SELECT value FROM ${table} WHERE id = ? LIMIT 1${lock}`, [id])
      : await client.unsafe(`SELECT value FROM ${table} WHERE id = $1 LIMIT 1${lock}`, [id]);
    const row = rows[0] as { value?: string } | undefined;
    return row?.value === undefined ? undefined : JSON.parse(row.value) as T;
  }
}

async function initialize(client: SQL, dialect: BunSqlDialect): Promise<void> {
  const valueType = dialect === "sqlite" ? "TEXT" : "TEXT";
  const statements = ["runs", "sessions", "workflow_runs"].map((resource) =>
    `CREATE TABLE IF NOT EXISTS lunar_${resource} (id VARCHAR(255) PRIMARY KEY, value ${valueType} NOT NULL)`,
  );
  for (const statement of statements) await client.unsafe(statement);
}

export interface BunSqlStores extends StorageBundle {
  runStore: RunStore;
  sessionStore: SessionStore;
  workflowStore: WorkflowStore;
  close(): Promise<void>;
  health(): Promise<void>;
}

export async function createBunSqlStores(options: BunSqlStorageOptions): Promise<BunSqlStores> {
  const client = typeof options.connection === "string" ? new SQL(options.connection) : options.connection;
  const dialect = options.dialect ?? (typeof options.connection === "string" ? inferDialect(options.connection) : "postgres");
  await initialize(client, dialect);
  const transactionQueue = dialect === "sqlite" ? new TransactionQueue() : undefined;
  const runs = new BunSqlStore<Run>(client, dialect, "runs", transactionQueue);
  const sessions = new BunSqlStore<Session>(client, dialect, "sessions", transactionQueue);
  const workflows = new BunSqlStore<WorkflowRun>(client, dialect, "workflow-runs", transactionQueue);
  const saveRunAndSession = dialect !== "postgres" ? undefined : async (run: Run, session: Session, saveOptions: SaveOptions = {}) => {
    return await client.begin(async (transaction) => {
      const tx = transaction as SQL;
      const runRows = await tx.unsafe("SELECT value FROM lunar_runs WHERE id = $1 FOR UPDATE", [run.id]);
      const sessionRows = await tx.unsafe("SELECT value FROM lunar_sessions WHERE id = $1 FOR UPDATE", [session.id]);
      const currentRun = runRows[0] ? JSON.parse((runRows[0] as { value: string }).value) as Run : undefined;
      const currentSession = sessionRows[0] ? JSON.parse((sessionRows[0] as { value: string }).value) as Session : undefined;
      if (saveOptions.expectedRevision === undefined && currentRun) throw new StorageConflictError("runs", run.id, undefined, currentRun.revision);
      if (saveOptions.expectedSessionRevision === undefined && currentSession) throw new StorageConflictError("sessions", session.id, undefined, currentSession.revision);
      if (saveOptions.expectedRevision !== undefined && (currentRun?.revision ?? 0) !== saveOptions.expectedRevision) throw new StorageConflictError("runs", run.id, saveOptions.expectedRevision, currentRun?.revision);
      if (saveOptions.expectedSessionRevision !== undefined && (currentSession?.revision ?? 0) !== saveOptions.expectedSessionRevision) throw new StorageConflictError("sessions", session.id, saveOptions.expectedSessionRevision, currentSession?.revision);
      const savedRun = { ...run, revision: (currentRun?.revision ?? -1) + 1 };
      const savedSession = { ...session, revision: (currentSession?.revision ?? -1) + 1 };
      await tx.unsafe("INSERT INTO lunar_runs (id, value) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value", [savedRun.id, JSON.stringify(savedRun)]);
      await tx.unsafe("INSERT INTO lunar_sessions (id, value) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value", [savedSession.id, JSON.stringify(savedSession)]);
      return { run: savedRun, session: savedSession };
    }) as { run: Run; session: Session };
  };
  return {
    capabilities: { optimisticConcurrency: true, atomicRunSession: dialect === "postgres" },
    runStore: runs,
    sessionStore: sessions,
    workflowStore: workflows,
    ...(saveRunAndSession ? { saveRunAndSession } : {}),
    health: async () => { await client.unsafe("SELECT 1"); },
    close: async () => { await client.close(); },
  };
}
