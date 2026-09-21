import { SQL } from "bun";
import type { Run, RunStore, Session, SessionStore, StorageBundle, WorkflowRun, WorkflowStore } from "@lunar/foundation";

export type BunSqlDialect = "postgres" | "mysql" | "sqlite";

export interface BunSqlStorageOptions {
  connection: string | SQL;
  dialect?: BunSqlDialect;
}

type StoredRecord = { id: string };

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

class BunSqlStore<T extends StoredRecord> {
  constructor(
    private readonly client: SQL,
    private readonly dialect: BunSqlDialect,
    private readonly resource: string,
  ) {}

  async save(value: T): Promise<void> {
    const table = quoteTable(this.resource);
    if (this.dialect === "mysql") {
      await this.client.unsafe(
        `INSERT INTO ${table} (id, value) VALUES (?, ?) ON DUPLICATE KEY UPDATE value = VALUES(value)`,
        [value.id, JSON.stringify(value)],
      );
      return;
    }
    await this.client.unsafe(
      `INSERT INTO ${table} (id, value) VALUES ($1, $2) ON CONFLICT (id) DO UPDATE SET value = excluded.value`,
      [value.id, JSON.stringify(value)],
    );
  }

  async get(id: string): Promise<T | undefined> {
    const table = quoteTable(this.resource);
    const rows = this.dialect === "mysql"
      ? await this.client.unsafe(`SELECT value FROM ${table} WHERE id = ? LIMIT 1`, [id])
      : await this.client.unsafe(`SELECT value FROM ${table} WHERE id = $1 LIMIT 1`, [id]);
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
}

export async function createBunSqlStores(options: BunSqlStorageOptions): Promise<BunSqlStores> {
  const client = typeof options.connection === "string" ? new SQL(options.connection) : options.connection;
  const dialect = options.dialect ?? (typeof options.connection === "string" ? inferDialect(options.connection) : "postgres");
  await initialize(client, dialect);
  const runs = new BunSqlStore<Run>(client, dialect, "runs");
  const sessions = new BunSqlStore<Session>(client, dialect, "sessions");
  const workflows = new BunSqlStore<WorkflowRun>(client, dialect, "workflow-runs");
  return {
    runStore: runs,
    sessionStore: sessions,
    workflowStore: workflows,
    close: async () => { await client.close(); },
  };
}
