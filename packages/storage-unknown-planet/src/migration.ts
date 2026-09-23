import type { Planet } from "@unknown-planet/sdk";

const TABLES = ["runs", "sessions", "workflow_runs"] as const;

/** Creates only Lunar-owned tables. Repeated calls preserve existing records. */
export async function migrateUnknownPlanetStorage(input: { planet: Planet }): Promise<void> {
  await input.planet.sql.transaction(async (sql) => {
    await sql.query({ text: "CREATE SCHEMA IF NOT EXISTS lunar" });
    for (const table of TABLES) {
      await sql.query({ text: `
        CREATE TABLE IF NOT EXISTS lunar.${table} (
          tenant_id text NOT NULL,
          workspace_id text NOT NULL DEFAULT '',
          id text NOT NULL,
          revision integer NOT NULL CHECK (revision >= 0),
          status text,
          value jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (tenant_id, workspace_id, id)
        )
      ` });
    }
    await sql.query({ text: "CREATE INDEX IF NOT EXISTS lunar_workflow_runs_recoverable_idx ON lunar.workflow_runs (tenant_id, workspace_id, id) WHERE status = 'running'" });
  });
}
