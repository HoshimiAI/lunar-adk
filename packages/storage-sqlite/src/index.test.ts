import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { unlinkSync } from "node:fs";
import { createRuntime, defineAgent, defineTool, defineWorkflow } from "@lunar/foundation";
import type { ModelProvider } from "@lunar/foundation/model";
import { createSqliteStores, SQLITE_SCHEMA_VERSION } from "./index";

test("persists runs and sessions in SQLite", async () => {
  const database = new Database(":memory:");
  const stores = createSqliteStores(database);
  expect((database.query("SELECT version FROM lunar_schema WHERE id = 1").get() as { version: number }).version)
    .toBe(SQLITE_SCHEMA_VERSION);
  const model: ModelProvider = {
    id: "sqlite-test",
    capabilities: {},
    async call() {
      return { text: "persisted", toolCalls: [] };
    },
  };
  const runtime = await createRuntime({ storage: stores, ownsStorage: true });
  runtime.registerAgent(defineAgent({ name: "assistant", model }));

  const result = await runtime.run("assistant", "hello");
  const restoredRun = await stores.runStore.get(result.run.id);
  const restoredSession = await stores.sessionStore.get(result.run.sessionId!);

  expect(restoredRun?.result).toBe("persisted");
  expect(restoredSession?.history.map((message) => message.content)).toEqual(["hello", "persisted"]);
  expect(restoredSession?.runs[0]?.id).toBe(result.run.id);
  expect(restoredSession?.runIds).toEqual([result.run.id]);
  await runtime.shutdown?.();
});

test("reopens a file-backed database without losing data", async () => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/lunar-adk-${crypto.randomUUID()}.db`;
  const first = createSqliteStores(path);
  await first.runStore.save({
    id: "run-1",
    status: "completed",
    startedAt: 1,
    events: [],
    trace: [],
    artifacts: [],
    usage: { inputTokens: 1, outputTokens: 2 },
  });
  first.close();

  const second = createSqliteStores(path);
  expect((await second.runStore.get("run-1"))?.usage.outputTokens).toBe(2);
  second.close();
  unlinkSync(path);
});

test("reopens a waiting approval and resumes it", async () => {
  const path = `${process.env.TMPDIR ?? "/tmp"}/lunar-adk-${crypto.randomUUID()}.db`;
  const first = createSqliteStores(path);
  const schema = { parse: (input: unknown) => input, toJSONSchema: () => ({ type: "string" }) };
  const tool = defineTool({
    name: "dangerous",
    description: "Requires approval",
    schema,
    permission: { requiresApproval: true },
    execute: () => "executed",
  });
  const firstModel: ModelProvider = {
    id: "approval-persisted",
    capabilities: { tools: true },
    async call() {
      return { text: "", toolCalls: [{ id: "persisted-call", name: "dangerous", input: "x" }] };
    },
  };
  const runtime = await createRuntime({ runStore: first.runStore, sessionStore: first.sessionStore });
  runtime.registerAgent(defineAgent({ name: "assistant", model: firstModel, tools: [tool] }));
  const pending = await runtime.run("assistant", "hello");
  first.close();

  const second = createSqliteStores(path);
  const secondModel: ModelProvider = {
    id: "approval-persisted",
    capabilities: { tools: true },
    async call({ messages }) {
      expect(messages.at(-1)?.role).toBe("tool");
      return { text: "resumed", toolCalls: [] };
    },
  };
  const restoredRuntime = await createRuntime({ runStore: second.runStore, sessionStore: second.sessionStore });
  restoredRuntime.registerAgent(defineAgent({ name: "assistant", model: secondModel, tools: [tool] }));
  const resumed = await restoredRuntime.approve(pending.run.id, pending.run.pendingApproval!.id);

  expect(resumed.output).toBe("resumed");
  expect(resumed.run.status).toBe("completed");
  second.close();
  unlinkSync(path);
});

test("persists workflow checkpoints", async () => {
  const database = new Database(":memory:");
  const stores = createSqliteStores(database);
  const runtime = await createRuntime({ workflowStore: stores.workflowStore });
  runtime.registerWorkflow(defineWorkflow({
    name: "checkpointed",
    run: async (ctx) => {
      await ctx.checkpoint("started", { value: 1 });
      return "done";
    },
  }));

  const result = await runtime.runWorkflow("checkpointed");
  const stored = await stores.workflowStore.get(result.id);

  expect(stored?.status).toBe("completed");
  expect(stored?.checkpoints).toHaveLength(1);
  expect(stored?.checkpoints[0]?.state).toEqual({ value: 1 });
  stores.close();
});
