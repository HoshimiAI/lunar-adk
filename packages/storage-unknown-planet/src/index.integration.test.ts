import { SQL } from "bun";
import { expect, test } from "bun:test";
import { StorageConflictError, type Run, type Session } from "@lunar/foundation";
import { verifyStorageBundle } from "@lunar/foundation/storage/testing";
import { Planet, type SqlStore } from "@unknown-planet/sdk";
import { createUnknownPlanetStorage, migrateUnknownPlanetStorage } from "./index.js";

const databaseUrl = process.env.UP_TEST_DATABASE_URL;
const liveTest = databaseUrl ? test : test.skip;

function sqlStore(client: SQL): SqlStore {
  return {
    async query<T extends Record<string, unknown> = Record<string, unknown>>(input: { text: string; values?: readonly unknown[] }) {
      const rows = await client.unsafe(input.text, [...(input.values ?? [])]);
      return { rows: rows as T[], rowCount: rows.length };
    },
    transaction: (work) => client.begin((transaction) => work(sqlStore(transaction as SQL))),
  };
}

liveTest("Planet SQL implements Lunar storage, isolation, and atomic save", async () => {
  const client = new SQL(databaseUrl!);
  try {
    const planet = new Planet({ sql: sqlStore(client) });
    await migrateUnknownPlanetStorage({ planet });
    await migrateUnknownPlanetStorage({ planet });
    const tenantId = `lunar-test-${crypto.randomUUID()}`;
    const storage = createUnknownPlanetStorage({ planet, scope: { tenantId, workspaceId: "one" } });
    await storage.health?.();
    await verifyStorageBundle(storage);

    const run: Run = { id: crypto.randomUUID(), tenantId, status: "completed", startedAt: Date.now(), events: [], trace: [], artifacts: [], usage: { inputTokens: 0, outputTokens: 0 } };
    const session: Session = { id: crypto.randomUUID(), tenantId, history: [], runIds: [] };
    const saved = await storage.saveRunAndSession!(run, session);
    expect(saved.run.revision).toBe(0);
    expect(saved.session.revision).toBe(0);
    expect((await storage.runStore.get(run.id))?.id).toBe(run.id);
    expect((await storage.sessionStore.get(session.id))?.id).toBe(session.id);

    const other = createUnknownPlanetStorage({ planet, scope: { tenantId, workspaceId: "two" } });
    expect(await other.runStore.get(run.id)).toBeUndefined();
    expect(await other.sessionStore.get(session.id)).toBeUndefined();

    const secondRun: Run = { ...run, id: crypto.randomUUID() };
    await expect(storage.saveRunAndSession!(secondRun, session)).rejects.toBeInstanceOf(StorageConflictError);
    expect(await storage.runStore.get(secondRun.id)).toBeUndefined();
  } finally {
    await client.close();
  }
});
