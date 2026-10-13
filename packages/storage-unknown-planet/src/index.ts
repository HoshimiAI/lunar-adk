import { StorageConflictError } from "@lunar-adk/foundation/storage";
import type { Run, RunStore, Session, SessionStore, WorkflowRun, WorkflowStore } from "@lunar-adk/foundation";
import type { SaveOptions, StorageBundle, StorageScope } from "@lunar-adk/foundation/storage";
import { PlanetProviderError, type Planet, type PlanetScope, type SqlTransaction } from "@unknown-planet/sdk";
export { migrateUnknownPlanetStorage } from "./migration.js";
export { createUnknownPlanetMemoryProvider } from "./memory.js";
export type { UnknownPlanetMemoryOptions } from "./memory.js";
export { createUnknownPlanetContextProvider } from "./context.js";
export type { UnknownPlanetContextOptions } from "./context.js";
export { createUnknownPlanetAdapters } from "./integration.js";
export type { UnknownPlanetIntegrationOptions } from "./integration.js";

type VersionedRecord = { id: string; revision?: number; tenantId?: string; workspaceId?: string; status?: string };
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

  private resolveScope(value?: StorageScope): PlanetScope {
    const tenantId = value?.tenantId ?? this.scope.tenantId;
    if (!tenantId.trim()) throw new Error("Unknown Planet storage requires a tenantId.");
    if (tenantId !== this.scope.tenantId) throw new Error("Record tenantId does not match the configured Unknown Planet scope.");
    const workspaceId = value?.workspaceId ?? this.scope.workspaceId;
    if (this.scope.workspaceId !== undefined && workspaceId !== this.scope.workspaceId) {
      throw new Error("Record workspaceId does not match the configured Unknown Planet scope.");
    }
    return { tenantId, ...(workspaceId ? { workspaceId } : {}) };
  }

  private params(id: string, scope: PlanetScope): [string, string, string] {
    return [scope.tenantId, scope.workspaceId ?? "", id];
  }

  async get(id: string, requestedScope?: StorageScope): Promise<T | undefined> {
    const scope = this.resolveScope(requestedScope);
    const result = await this.planet.withScope(scope).sql.query<Row>({
      text: `SELECT value, revision FROM lunar.${this.table} WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      values: this.params(id, scope),
    });
    if (!result.rows[0]) return undefined;
    const value = recordFromRow<T>(result.rows[0].value);
    return { ...value, tenantId: value.tenantId ?? scope.tenantId, workspaceId: value.workspaceId ?? scope.workspaceId };
  }

  async save(value: T, options: SaveOptions = {}): Promise<T> {
    const scope = this.resolveScope(value);
    return this.saveUsing((input) => this.planet.withScope(scope).sql.execute<Row>(input), value, options.expectedRevision, scope);
  }

  async saveUsing(query: QueryRows, value: T, expectedRevision?: number, requestedScope?: StorageScope): Promise<T> {
    const scope = this.resolveScope(requestedScope ?? value);
    if (value.tenantId !== undefined && value.tenantId !== scope.tenantId) throw new Error("Record tenantId does not match the storage scope.");
    if (value.workspaceId !== undefined && value.workspaceId !== scope.workspaceId) throw new Error("Record workspaceId does not match the storage scope.");
    const params = this.params(value.id, scope);
    const nextRevision = expectedRevision === undefined ? 0 : expectedRevision + 1;
    const saved = { ...value, tenantId: value.tenantId ?? scope.tenantId, workspaceId: value.workspaceId ?? scope.workspaceId, revision: nextRevision };
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
        values: [...params, status, JSON.stringify({ ...value, tenantId: saved.tenantId, workspaceId: saved.workspaceId, revision: 0 })],
      });
      if (created.rows[0]) return recordFromRow<T>(created.rows[0].value);
    }

    const current = await query({
      text: `SELECT revision, value FROM lunar.${this.table} WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3`,
      values: params,
    });
    throw new StorageConflictError(this.resource, value.id, expectedRevision, current.rows[0]?.revision);
  }

  async listRecoverable(requestedScope?: StorageScope): Promise<T[]> {
    const scope = this.resolveScope(requestedScope);
    const result = await this.planet.withScope(scope).sql.query<Row>({
      text: `SELECT value, revision FROM lunar.${this.table} WHERE tenant_id=$1 AND workspace_id=$2 AND status='running' ORDER BY id`,
      values: [scope.tenantId, scope.workspaceId ?? ""],
    });
    return result.rows.map((row) => {
      const value = recordFromRow<T>(row.value);
      return { ...value, tenantId: value.tenantId ?? scope.tenantId, workspaceId: value.workspaceId ?? scope.workspaceId };
    });
  }
}

/** The Planet client and its database connection remain owned by the caller. */
export function createUnknownPlanetStorage(options: UnknownPlanetStorageOptions): StorageBundle {
  if (!options.scope.tenantId.trim()) throw new Error("Unknown Planet storage requires a tenantId.");
  const planet = options.planet;
  const runs = new VersionedStore<Run>(planet, options.scope, "runs", "runs");
  const sessions = new VersionedStore<Session>(planet, options.scope, "sessions", "sessions");
  const workflows = new VersionedStore<WorkflowRun>(planet, options.scope, "workflow_runs", "workflow-runs");
  const runStore: RunStore = runs;
  const sessionStore: SessionStore = sessions;
  const workflowStore: WorkflowStore = {
    save: (value, saveOptions) => workflows.save(value, saveOptions),
    get: (id, scope) => workflows.get(id, scope),
    listRecoverable: (scope) => workflows.listRecoverable(scope),
  };

  return {
    capabilities: { optimisticConcurrency: true, atomicRunSession: true },
    runStore,
    sessionStore,
    workflowStore,
    saveRunAndSession: async (run, session, saveOptions = {}) => {
      const scope = { tenantId: run.tenantId ?? options.scope.tenantId, workspaceId: run.workspaceId ?? options.scope.workspaceId };
      if (session.tenantId !== undefined && session.tenantId !== scope.tenantId) throw new Error("Run and session tenant scopes do not match.");
      if (session.workspaceId !== undefined && session.workspaceId !== scope.workspaceId) throw new Error("Run and session workspace scopes do not match.");
      try {
        return await planet.withScope(scope).sql.transaction(async (sql) => {
          const savedRun = await runs.saveUsing((input) => sql.query<Row>(input), run, saveOptions.expectedRevision, scope);
          const savedSession = await sessions.saveUsing((input) => sql.query<Row>(input), session, saveOptions.expectedSessionRevision, scope);
          return { run: savedRun, session: savedSession };
        });
      } catch (error) {
        if (error instanceof PlanetProviderError && error.cause instanceof StorageConflictError) throw error.cause;
        throw error;
      }
    },
    health: async () => { await planet.withScope(options.scope).sql.query({ text: "SELECT 1" }); },
  };
}
