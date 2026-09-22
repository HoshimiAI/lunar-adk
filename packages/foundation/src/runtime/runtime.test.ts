import { expect, test } from "bun:test";
import { createRuntime, defineAgent, definePlugin, InMemoryRunStore, StorageConflictError, type Workflow } from "../index";
import { createInMemoryProvider, MemoryRegistry, type MemoryProvider } from "../memory";
import type { ModelProvider } from "../model";

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

test("retrieves and stores opt-in agent memory", async () => {
  const provider = createInMemoryProvider("custom-memory");
  await provider.store({ content: "blue is the remembered color", namespace: "preferences" });
  const model: ModelProvider = {
    id: "memory-model",
    capabilities: {},
    async call({ messages }) {
      expect(messages.some((message) => message.role === "system" && message.content.includes("remembered color"))).toBe(true);
      return { text: "done", toolCalls: [] };
    },
  };
  const runtime = await createRuntime({ memory: provider });
  runtime.registerAgent(defineAgent({
    name: "assistant",
    model,
    memory: { providerId: provider.id, namespace: "preferences" },
  }));

  await runtime.run("assistant", "blue");

  expect((await provider.retrieve({ text: "Assistant: done", namespace: "preferences" }))).toHaveLength(1);
  expect(runtime.getMemoryProvider(provider.id)).toBe(provider);
});

test("rejects duplicate memory provider IDs", () => {
  const registry = new MemoryRegistry();
  registry.register(createInMemoryProvider("duplicate"));
  expect(() => registry.register(createInMemoryProvider("duplicate"))).toThrow("Memory provider already registered: duplicate");
});

test("closes owned memory providers", async () => {
  let closed = false;
  const provider: MemoryProvider = {
    id: "owned",
    async store(record) {
      return { ...record, id: "memory-1", createdAt: 1 };
    },
    async retrieve() {
      return [];
    },
    close() {
      closed = true;
    },
  };
  const runtime = await createRuntime({ memory: provider, ownsMemory: true });
  await runtime.shutdown?.();
  expect(closed).toBe(true);
});
