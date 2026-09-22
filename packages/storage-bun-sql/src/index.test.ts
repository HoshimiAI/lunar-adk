import { expect, test } from "bun:test";
import { createBunSqlStores } from "./index";
import { verifyStorageBundle } from "@lunar/foundation/storage/testing";

test("stores records in Bun.SQL SQLite mode", async () => {
  const stores = await createBunSqlStores({ connection: ":memory:", dialect: "sqlite" });
  await stores.runStore.save({ id: "run-1", status: "completed", startedAt: 1, events: [], trace: [], artifacts: [], usage: { inputTokens: 0, outputTokens: 0 } });
  expect((await stores.runStore.get("run-1"))?.status).toBe("completed");
  expect(await stores.sessionStore.get("missing")).toBeUndefined();
  await verifyStorageBundle(stores);
  await stores.close();
});

test("lists running workflows for recovery", async () => {
  const stores = await createBunSqlStores({ connection: ":memory:", dialect: "sqlite" });
  const base = {
    workflow: "recoverable",
    version: "1",
    input: {},
    state: {},
    checkpoints: [],
    childRunIds: [],
    startedAt: 1,
    approvedApprovalIds: [],
  };
  await stores.workflowStore.save({ ...base, id: "running", status: "running" });
  await stores.workflowStore.save({ ...base, id: "completed", status: "completed" });

  expect((await stores.workflowStore.listRecoverable?.())?.map((run) => run.id)).toEqual(["running"]);
  await stores.close();
});
