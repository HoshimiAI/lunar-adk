import { expect, test } from "bun:test";
import { AgentRunError, createRuntime, defineAgent, definePlugin, defineTool, InMemoryRunStore, InMemoryWorkflowStore, StorageConflictError, type Workflow } from "../index";
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

test("applies first-match policy rules before agent model calls", async () => {
  let modelCalls = 0;
  const runtime = await createRuntime({
    policyRules: [
      { id: "allow-assistant", effect: "allow", action: "agent.run", name: "assistant" },
      { id: "deny-other-agents", effect: "deny", action: "agent.run" },
    ],
  });
  runtime.registerAgent(defineAgent({
    name: "assistant",
    model: { id: "model", capabilities: {}, async call() { modelCalls++; return { text: "ok", toolCalls: [] }; } },
  }));

  await runtime.run("assistant", "hello");
  expect(modelCalls).toBe(1);
});

test("accepts plugin policy rules after application policy rules", async () => {
  let modelCalls = 0;
  const blockAssistant = definePlugin({
    id: "block-assistant",
    version: "1.0.0",
    register(context) {
      context.policies.register({ id: "plugin-block", effect: "deny", action: "agent.run", name: "assistant" });
    },
  });
  const model = { id: "model", capabilities: {}, async call() { modelCalls++; return { text: "ok", toolCalls: [] }; } };

  const denied = await createRuntime({ plugins: [blockAssistant] });
  denied.registerAgent(defineAgent({ name: "assistant", model }));
  await expect(denied.run("assistant", "hello")).rejects.toMatchObject({ code: "POLICY_DENIED" });

  const allowed = await createRuntime({
    plugins: [blockAssistant],
    policyRules: [{ id: "app-allow", effect: "allow", action: "agent.run", name: "assistant" }],
  });
  allowed.registerAgent(defineAgent({ name: "assistant", model }));
  await allowed.run("assistant", "hello");

  expect(modelCalls).toBe(1);
});

test("persists policy-denied agent and tool runs without executing work", async () => {
  let modelCalls = 0;
  let toolCalls = 0;
  const runtime = await createRuntime({
    policyRules: [{ id: "block-shell", effect: "deny", action: "tool.execute", name: "shell" }],
  });
  runtime.registerAgent(defineAgent({
    name: "assistant",
    tools: [defineTool({ name: "shell", description: "runs a command", schema: { parse: (value) => String(value), toJSONSchema: () => ({ type: "string" }) }, execute() { toolCalls++; return "ran"; } })],
    model: { id: "model", capabilities: {}, async call() { modelCalls++; return { text: "", toolCalls: [{ id: "call-1", name: "shell", input: "pwd" }] }; } },
  }));

  let failure: unknown;
  try {
    await runtime.run("assistant", "hello");
  } catch (error) {
    failure = error;
  }

  expect(failure).toBeInstanceOf(AgentRunError);
  const runError = failure as AgentRunError;
  expect(runError.code).toBe("POLICY_DENIED");
  expect(runError.message).toContain('Policy rule "block-shell" denied tool.execute for "shell"');
  expect((await runtime.getStoredRun(runError.run.id))?.status).toBe("failed");
  expect(modelCalls).toBe(1);
  expect(toolCalls).toBe(0);
});

test("denies workflows before their body runs", async () => {
  let workflowCalls = 0;
  const runtime = await createRuntime({
    policyRules: [{ id: "block-publish", effect: "deny", action: "workflow.run", name: "publish" }],
  });
  runtime.registerWorkflow({ name: "publish", version: "1", async run() { workflowCalls++; return "published"; } });

  const run = await runtime.runWorkflow("publish");
  expect(run.status).toBe("failed");
  expect(run.error).toContain('Policy rule "block-publish" denied workflow.run for "publish"');
  expect(workflowCalls).toBe(0);
});

test("reapplies workflow policy during resume and recovery", async () => {
  const store = new InMemoryWorkflowStore();
  let workflowCalls = 0;
  const workflow: Workflow = {
    name: "publish",
    version: "1",
    async run(context) {
      if (!context.run.approvedApprovalIds.includes("publish")) {
        await context.requestApproval("publish", "Publish the release");
      }
      workflowCalls++;
      return "published";
    },
  };
  const permitted = await createRuntime({ workflowStore: store });
  permitted.registerWorkflow(workflow);
  const waiting = await permitted.runWorkflow("publish");
  await store.save({
    id: "recover-publish",
    workflow: "publish",
    version: "1",
    status: "running",
    input: undefined,
    state: {},
    checkpoints: [],
    childRunIds: [],
    startedAt: Date.now(),
    approvedApprovalIds: [],
  });

  const restricted = await createRuntime({
    workflowStore: store,
    policyRules: [{ id: "freeze-publish", effect: "deny", action: "workflow.run", name: "publish" }],
  });
  restricted.registerWorkflow(workflow);

  expect((await restricted.resumeWorkflow(waiting.id, "publish")).status).toBe("failed");
  expect((await restricted.recoverWorkflows())[0]?.status).toBe("failed");
  expect(workflowCalls).toBe(0);
});

test("manages plugin lifecycle and exposes installed plugin metadata", async () => {
  const calls: string[] = [];
  const runtime = await createRuntime({
    plugins: [{
      id: "support-bundle",
      version: "1.0.0",
      description: "Customer support tools and workflows",
      register() { calls.push("register"); },
      start() { calls.push("start"); },
      stop() { calls.push("stop"); },
    }],
  });

  expect(calls).toEqual(["register", "start"]);
  expect(runtime.listPlugins()).toEqual([{
    id: "support-bundle",
    version: "1.0.0",
    description: "Customer support tools and workflows",
    status: "enabled",
  }]);

  await runtime.shutdown?.();
  expect(calls).toEqual(["register", "start", "stop"]);
  expect(runtime.listPlugins()[0]?.status).toBe("disabled");
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

test("retrieves embedded memory semantically when an embedding provider is configured", async () => {
  const provider = createInMemoryProvider();
  const embedding = { id: "test-embedding", async embed(input: string) { return input.includes("weather") ? [1, 0] : [0, 1]; } };
  await provider.store({ content: "The forecast is sunny", tenantId: "tenant-a", embedding: [1, 0] });
  let receivedHistory = "";
  const runtime = await createRuntime({ memory: provider, embedding });
  runtime.registerAgent(defineAgent({
    name: "assistant",
    memory: true,
    model: { id: "model", capabilities: {}, async call({ messages }) { receivedHistory = messages.map((message) => message.content).join("\n"); return { text: "ok", toolCalls: [] }; } },
  }));

  await runtime.run("assistant", "What is the weather?", { tenantId: "tenant-a" });

  expect(receivedHistory).toContain("The forecast is sunny");
});

test("does not call Lunar embeddings when the memory provider owns embedding", async () => {
  let embeddingCalls = 0;
  let receivedEmbedding: number[] | undefined;
  const provider: MemoryProvider = {
    id: "planet-memory",
    capabilities: { semanticSearch: true, embeddingOwner: "provider" },
    async store(input) { return { ...input, id: "stored", createdAt: Date.now() }; },
    async retrieve(query) { receivedEmbedding = query.embedding; return []; },
  };
  const runtime = await createRuntime({
    memory: provider,
    embedding: { id: "adk-embedding", async embed() { embeddingCalls += 1; return [1, 0]; } },
  });
  runtime.registerAgent(defineAgent({
    name: "assistant",
    model: { id: "model", capabilities: {}, async call() { return { text: "ok", toolCalls: [] }; } },
    memory: { providerId: provider.id, store: "none" },
  }));

  await runtime.run("assistant", "hello");

  expect(embeddingCalls).toBe(0);
  expect(receivedEmbedding).toBeUndefined();
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
