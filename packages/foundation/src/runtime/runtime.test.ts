import { expect, test } from "bun:test";
import { createRuntime, definePlugin, InMemoryRunStore, StorageConflictError, type Workflow } from "../index";
import { createInMemoryProvider, type MemoryProvider } from "../memory";

test("registers the configured memory provider for plugins", async () => {
  const provider = createInMemoryProvider("custom-memory");
  let registered: MemoryProvider | undefined;

  await createRuntime({
    memory: provider,
    plugins: [{
      id: "memory-plugin",
      version: "1.0.0",
      register(context) {
        registered = context.memory.get("custom-memory");
      },
    }],
  });

  expect(registered).toBe(provider);
});

test("keeps an in-memory provider as the default", async () => {
  let registered: MemoryProvider | undefined;

  await createRuntime({
    plugins: [definePlugin({
      id: "default-memory-plugin",
      version: "1.0.0",
      register(context) {
        registered = context.memory.get("in-memory");
      },
    })],
  });

  expect(registered?.id).toBe("in-memory");
});

test("runs workflows registered by plugins", async () => {
  const workflow: Workflow = {
    name: "plugin-workflow",
    version: "1",
    async run() {
      return "registered";
    },
  };
  const runtime = await createRuntime({
    plugins: [{
      id: "workflow-plugin",
      version: "1.0.0",
      register(context) {
        context.workflows.register(workflow);
      },
    }],
  });

  const result = await runtime.runWorkflow("plugin-workflow");
  expect(result.output).toBe("registered");
});

test("rejects stale run revisions", async () => {
  const store = new InMemoryRunStore();
  const first = await store.save({ id: "run-1", status: "pending", startedAt: 1, events: [], trace: [], artifacts: [], usage: { inputTokens: 0, outputTokens: 0 } });
  await store.save({ ...first, status: "running" }, { expectedRevision: first.revision });

  await expect(store.save({ ...first, status: "failed" }, { expectedRevision: first.revision }))
    .rejects.toBeInstanceOf(StorageConflictError);
});
