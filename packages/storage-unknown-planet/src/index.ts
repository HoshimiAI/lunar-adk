import { StorageConflictError } from "@lunar/foundation/storage";
import type { Run, RunStore, Session, SessionStore, WorkflowRun, WorkflowStore } from "@lunar/foundation";
import type { SaveOptions, StorageBundle } from "@lunar/foundation/storage";
import { PlanetProviderError, type Planet, type PlanetScope, type SqlTransaction } from "@unknown-planet/sdk";
export { migrateUnknownPlanetStorage } from "./migration.js";
export { createUnknownPlanetMemoryProvider } from "./memory.js";
export type { UnknownPlanetMemoryOptions } from "./memory.js";

type VersionedRecord = { id: string; revision?: number; tenantId?: string; status?: string };
type Table = "runs" | "sessions" | "workflow_runs";
type Row = { value: unknown; revision: number };
type QueryRows = (input: Parameters<SqlTransaction["query"]>[0]) => Promise<{ rows: Row[] }>;

export interface UnknownPlanetStorageOptions {
  planet: Planet;
  scope: PlanetScope;
}

function recordFromRow<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

class VersionedStore<T extends VersionedRecord> {
  constructor(
    private readonly planet: Planet,
    private readonly scope: PlanetScope,
    private readonly table: Table,
    private readonly resource: string,
  ) {}

  private params(id: string): [string, string, string] {
    return [this.scope.tenantId, this.scope.workspaceId ?? "", id];
  }

  async get(id: string): Promise<T | undefined> {
    const result = await this.planet.sql.query<Row>({
      text: `SELECT value, revision FROM lunar.${this.table} WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      values: this.params(id),
    });
    return result.rows[0] ? recordFromRow<T>(result.rows[0].value) : undefined;
  }

  async save(value: T, options: SaveOptions = {}): Promise<T> {
    return this.saveUsing((input) => this.planet.sql.execute<Row>(input), value, options.expectedRevision);
  }

  async saveUsing(query: QueryRows, value: T, expectedRevision?: number): Promise<T> {
    if (value.tenantId !== undefined && value.tenantId !== this.scope.tenantId) {
      throw new Error(`Record tenantId does not match the configured Planet scope.`);
    }
    const params = this.params(value.id);
    const nextRevision = expectedRevision === undefined ? 0 : expectedRevision + 1;
    const saved = { ...value, revision: nextRevision };
    const payload = JSON.stringify(saved);
    const status = value.status ?? null;

    if (expectedRevision !== undefined) {
      const updated = await query({
        text: `UPDATE lunar.${this.table} SET revision=$4, status=$5, value=$6::jsonb, updated_at=now() WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3 AND revision=$7 RETURNING value, revision`,
        values: [...params, nextRevision, status, payload, expectedRevision],
      });
      if (updated.rows[0]) return recordFromRow<T>(updated.rows[0].value);
    }

    if (expectedRevision === undefined || expectedRevision === 0) {
      const created = await query({
        text: `INSERT INTO lunar.${this.table} (tenant_id, workspace_id, id, revision, status, value) VALUES ($1,$2,$3,0,$4,$5::jsonb) ON CONFLICT DO NOTHING RETURNING value, revision`,
        values: [...params, status, JSON.stringify({ ...value, revision: 0 })],
      });
      if (created.rows[0]) return recordFromRow<T>(created.rows[0].value);
    }

    const current = await query({
      text: `SELECT revision, value FROM lunar.${this.table} WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      values: params,
    });
    throw new StorageConflictError(this.resource, value.id, expectedRevision, current.rows[0]?.revision);
  }

  async listRecoverable(): Promise<T[]> {
    const result = await this.planet.sql.query<Row>({
      text: `SELECT value, revision FROM lunar.${this.table} WHERE tenant_id=$1 AND workspace_id=$2 AND status='running' ORDER BY id`,
      values: [this.scope.tenantId, this.scope.workspaceId ?? ""],
    });
    return result.rows.map((row) => recordFromRow<T>(row.value));
  }
}

/** The Planet client and its database connection remain owned by the caller. */
export function createUnknownPlanetStorage(options: UnknownPlanetStorageOptions): StorageBundle {
  if (!options.scope.tenantId.trim()) throw new Error("Unknown Planet storage requires a tenantId.");
  const planet = options.planet.withScope(options.scope);
  const runs = new VersionedStore<Run>(planet, options.scope, "runs", "runs");
  const sessions = new VersionedStore<Session>(planet, options.scope, "sessions", "sessions");
  const workflows = new VersionedStore<WorkflowRun>(planet, options.scope, "workflow_runs", "workflow-runs");
  const runStore: RunStore = runs;
  const sessionStore: SessionStore = sessions;
  const workflowStore: WorkflowStore = {
    save: (value, saveOptions) => workflows.save(value, saveOptions),
    get: (id) => workflows.get(id),
    listRecoverable: () => workflows.listRecoverable(),
  };

  return {
    capabilities: { optimisticConcurrency: true, atomicRunSession: true },
    runStore,
    sessionStore,
    workflowStore,
    saveRunAndSession: async (run, session, saveOptions = {}) => {
      try {
        return await planet.sql.transaction(async (sql) => {
          const savedRun = await runs.saveUsing((input) => sql.query<Row>(input), run, saveOptions.expectedRevision);
          const savedSession = await sessions.saveUsing((input) => sql.query<Row>(input), session, saveOptions.expectedSessionRevision);
          return { run: savedRun, session: savedSession };
        });
      } catch (error) {
        if (error instanceof PlanetProviderError && error.cause instanceof StorageConflictError) throw error.cause;
        throw error;
      }
    },
    health: async () => { await planet.sql.query({ text: "SELECT 1" }); },
  };
}
