import { describe, expect, test } from "bun:test";
import { createRuntime, defineAgent, definePlugin, defineTool, defineWorkflow, InMemoryWorkflowStore } from "@lunar/adk";
import type { MemoryProvider, ModelProvider } from "@lunar/adk";
import { createApp, createAppWithBetterAuth, createDefaultApp, createInMemoryRateLimitStore } from "./app";
import { calculatorTool, currentTimeTool } from "./tools";

const testModel: ModelProvider = {
  id: "test",
  capabilities: {},
  async call({ messages }) {
    return { text: `Test: ${messages.at(-1)?.content ?? ""}`, toolCalls: [] };
  },
};

test("default app requires an explicit authentication decision", async () => {
  await expect(createDefaultApp()).rejects.toThrow("requires an AuthProvider or allowUnauthenticated: true");
});

test("redacts internal run failures from HTTP responses", async () => {
  const secret = "provider-secret-value";
  const runtime = await createRuntime();
  runtime.registerAgent(defineAgent({
    name: "assistant",
    model: { id: "failing", capabilities: {}, async call() { throw new Error(secret); } },
  }));
  const app = await createApp(runtime);
  const response = await app.handle(new Request("http://localhost/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "hello" }),
  }));
  const failure = await response.json() as { error: string; runId: string };
  const inspected = await app.handle(new Request(`http://localhost/runs/${failure.runId}`));
  const publicRecord = await inspected.json();
  const storedRecord = await runtime.getStoredRun(failure.runId);

  expect(response.status).toBe(500);
  expect(failure.error).toBe("Agent run failed");
  expect(inspected.status).toBe(200);
  expect(JSON.stringify(publicRecord)).not.toContain(secret);
  expect(storedRecord?.error).toContain(secret);
});

async function createTestApp() {
  const runtime = await createRuntime();
  runtime.registerAgent(
    defineAgent({ name: "assistant", model: testModel, systemPrompt: "Test assistant" }),
  );
  return createApp(runtime);
}

describe("Elysia app", () => {
test("exposes installed plugin bundles and runs their workflows", async () => {
    const runtime = await createRuntime({
      plugins: [definePlugin({
        id: "greeting",
        version: "1.0.0",
        register(context) {
          context.workflows.register(defineWorkflow({
            name: "greet",
            async run({ input }) { return { message: `Hello, ${(input as { name: string }).name}!` }; },
          }));
        },
      })],
    });
    const app = await createApp(runtime);

    const plugins = await app.handle(new Request("http://localhost/plugins"));
    const workflow = await app.handle(new Request("http://localhost/workflows/greet/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: { name: "Lunar" } }),
    }));

    expect(await plugins.json()).toEqual({ plugins: [{ id: "greeting", version: "1.0.0", status: "enabled" }] });
    expect(await workflow.json()).toMatchObject({ status: "completed", output: { message: "Hello, Lunar!" } });
  });

  test("mounts Better Auth while protecting Lunar routes", async () => {
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model: testModel }));
    const app = await createAppWithBetterAuth(runtime, {
      betterAuth: {
        handler: (request) => new Response(JSON.stringify({ path: new URL(request.url).pathname }), { headers: { "content-type": "application/json" } }),
        api: { async getSession() { return { user: { id: "user" }, session: { id: "session" } }; } },
      },
      mapPrincipal: ({ user }) => ({ subjectId: user.id, tenantId: "tenant-a", permissions: [] }),
    });
    const login = await app.handle(new Request("http://localhost/api/auth/ok"));
    expect(login.status).toBe(200);
    const run = await app.handle(new Request("http://localhost/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "hello" }) }));
    expect(run.status).toBe(200);
  });

  test("requires a verified principal when auth is configured", async () => {
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model: testModel }));
    const app = await createApp(runtime, {
      auth: { async authenticate(request) { return request.headers.get("authorization") === "Bearer ok" ? { subjectId: "user", tenantId: "tenant-a", permissions: ["memory:read", "memory:write", "memory:delete"] } : undefined; } },
    });
    const unauthorized = await app.handle(new Request("http://localhost/run", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input: "hello" }) }));
    expect(unauthorized.status).toBe(401);
    const authorized = await app.handle(new Request("http://localhost/run", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer ok" }, body: JSON.stringify({ input: "hello" }) }));
    const body = await authorized.json();
    const stored = await runtime.getStoredRun(body.runId);
    expect(authorized.status).toBe(200);
    expect(stored?.tenantId).toBe("tenant-a");
  });

  test("hides tenant records from another authenticated tenant", async () => {
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model: testModel }));
    const app = await createApp(runtime, {
      auth: { async authenticate(request) { const tenantId = request.headers.get("authorization") === "Bearer b" ? "tenant-b" : "tenant-a"; return { subjectId: tenantId, tenantId, permissions: [] }; } },
    });
    const created = await app.handle(new Request("http://localhost/run", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer a" }, body: JSON.stringify({ input: "hello" }) }));
    const { runId } = await created.json();
    const inspected = await app.handle(new Request(`http://localhost/runs/${runId}`, { headers: { authorization: "Bearer b" } }));
    expect(inspected.status).toBe(404);
  });

  test("isolates sessions, runs, and memories between users in one tenant", async () => {
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model: testModel }));
    const app = await createApp(runtime, {
      auth: { async authenticate(request) {
        const subjectId = request.headers.get("authorization") === "Bearer user-b" ? "user-b" : "user-a";
        return { subjectId, tenantId: "tenant-a", permissions: ["memory:read", "memory:write"] };
      } },
    });
    const request = (path: string, token: string, init?: RequestInit) => app.handle(new Request(`http://localhost${path}`, {
      ...init,
      headers: { ...(init?.headers as Record<string, string> | undefined), ...(init?.body ? { "content-type": "application/json" } : {}), authorization: `Bearer ${token}` },
    }));
    const created = await request("/run", "user-a", { method: "POST", body: JSON.stringify({ input: "private context" }) });
    const run = await created.json();
    const ownerRun = await request(`/runs/${run.runId}`, "user-a");
    const otherRun = await request(`/runs/${run.runId}`, "user-b");
    const otherSession = await request(`/sessions/${run.sessionId}`, "user-b");
    const memory = await request("/memories", "user-a", { method: "POST", body: JSON.stringify({ content: "private memory", expiresAt: new Date(Date.now() + 60_000).toISOString() }) });
    const otherMemories = await request("/memories", "user-b");

    expect(ownerRun.status).toBe(200);
    expect(otherRun.status).toBe(404);
    expect(otherSession.status).toBe(404);
    expect(memory.status).toBe(201);
    expect((await otherMemories.json()).records).toHaveLength(0);
  });

  test("enforces tenant-specific request quotas and returns retry headers", async () => {
    const runtime = await createRuntime();
    const app = await createApp(runtime, {
      auth: {
        async authenticate(request) {
          const tenantId = request.headers.get("authorization") === "Bearer b" ? "tenant-b" : "tenant-a";
          return { subjectId: tenantId, tenantId, permissions: [] };
        },
      },
      rateLimit: { windowMs: 60_000, maxRequests: 3, tenantQuotas: { "tenant-a": 1 } },
    });
    const request = (token: string) => new Request("http://localhost/runs/missing", { headers: { authorization: `Bearer ${token}` } });

    const first = await app.handle(request("a"));
    const limited = await app.handle(request("a"));
    const otherTenant = await app.handle(request("b"));

    expect(first.status).toBe(404);
    expect(first.headers.get("X-RateLimit-Limit")).toBe("1");
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(await limited.json()).toEqual({ error: "Rate limit exceeded", tenantId: "tenant-a" });
    expect(otherTenant.status).toBe(404);
    expect(otherTenant.headers.get("X-RateLimit-Limit")).toBe("3");
  });

  test("does not rate limit health checks", async () => {
    const runtime = await createRuntime();
    const app = await createApp(runtime, { rateLimit: { windowMs: 60_000, maxRequests: 1 } });
    await app.handle(new Request("http://localhost/runs/missing"));

    const response = await app.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
  });

  test("recovers workflows before returning the app when enabled", async () => {
    const store = new InMemoryWorkflowStore();
    await store.save({
      id: "startup-recovery",
      workflow: "startup-recovery",
      version: "1",
      status: "running",
      input: "continue",
      state: {},
      checkpoints: [],
      childRunIds: [],
      startedAt: 1,
      approvedApprovalIds: [],
    });
    const runtime = await createRuntime({ workflowStore: store });
    runtime.registerWorkflow(defineWorkflow({ name: "startup-recovery", run: async (ctx) => ctx.input }));

    await createApp(runtime, { recoverWorkflowsOnStartup: true });

    expect((await runtime.getWorkflowRun("startup-recovery"))?.status).toBe("completed");
  });

  test("applies a tenant quota atomically to concurrent requests", async () => {
    const runtime = await createRuntime();
    const app = await createApp(runtime, {
      auth: { async authenticate() { return { subjectId: "user", tenantId: "tenant-a", permissions: [] }; } },
      rateLimit: { windowMs: 60_000, maxRequests: 1 },
    });
    const responses = await Promise.all([
      app.handle(new Request("http://localhost/runs/missing")),
      app.handle(new Request("http://localhost/runs/missing")),
    ]);

    expect(responses.map(({ status }) => status).sort()).toEqual([404, 429]);
  });

  test("refills in-memory quota buckets and bounds tenant state", async () => {
    const store = createInMemoryRateLimitStore(1);
    const options = { limit: 1, windowMs: 20 };
    expect(store.consume("tenant-a", options).remaining).toBe(0);
    expect(() => store.consume("tenant-b", options)).toThrow("Rate limit store capacity exceeded");
    await Bun.sleep(30);
    expect(store.consume("tenant-a", options).remaining).toBe(0);
    await Bun.sleep(30);
    expect(store.consume("tenant-b", options).remaining).toBe(0);
  });

  test("fails closed when the configured rate-limit store is unavailable", async () => {
    const runtime = await createRuntime();
    const app = await createApp(runtime, {
      rateLimit: { windowMs: 60_000, maxRequests: 1 },
      rateLimitStore: { consume() { throw new Error("backend unavailable"); } },
    });
    const response = await app.handle(new Request("http://localhost/runs/missing"));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Rate limiter unavailable" });
  });

  test("manages tenant-scoped curated memory with permissions", async () => {
    const runtime = await createRuntime();
    const principal = { subjectId: "user", tenantId: "tenant-a", permissions: ["memory:read", "memory:write", "memory:delete"] };
    const app = await createApp(runtime, { auth: { async authenticate() { return principal; } } });
    const created = await app.handle(new Request("http://localhost/memories", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ content: "Customer prefers email", expiresAt: new Date(Date.now() + 60_000).toISOString() }) }));
    const record = await created.json();
    expect(created.status).toBe(201);
    const listed = await app.handle(new Request("http://localhost/memories"));
    expect((await listed.json()).records).toHaveLength(1);
    const deleted = await app.handle(new Request(`http://localhost/memories/${record.id}`, { method: "DELETE" }));
    expect(deleted.status).toBe(200);
  });

  test("does not invoke the ADK embedding provider for provider-owned memory", async () => {
    let embeddingCalls = 0;
    let receivedEmbedding: number[] | undefined;
    const provider: MemoryProvider = {
      id: "planet-memory",
      capabilities: { semanticSearch: true, embeddingOwner: "provider" },
      async store(input) { return { ...input, id: "planet-record", createdAt: Date.now() }; },
      async retrieve(query) { receivedEmbedding = query.embedding; return []; },
    };
    const runtime = await createRuntime({ memory: provider });
    const app = await createApp(runtime, {
      auth: { async authenticate() { return { subjectId: "user-a", tenantId: "tenant-a", permissions: ["memory:read", "memory:write"] }; } },
      embedding: { id: "adk-embedding", async embed() { embeddingCalls += 1; return [1, 0]; } },
    });
    const headers = { "content-type": "application/json" };
    const created = await app.handle(new Request("http://localhost/memories", {
      method: "POST", headers,
      body: JSON.stringify({ content: "raw content", expiresAt: new Date(Date.now() + 60_000).toISOString() }),
    }));
    const searched = await app.handle(new Request("http://localhost/memories/search", {
      method: "POST", headers,
      body: JSON.stringify({ text: "raw query" }),
    }));

    expect(created.status).toBe(201);
    expect(searched.status).toBe(200);
    expect(embeddingCalls).toBe(0);
    expect(receivedEmbedding).toBeUndefined();
  });

  test("ingests a text upload as embedded, tenant-scoped memory chunks", async () => {
    const runtime = await createRuntime();
    const principal = { subjectId: "user", tenantId: "tenant-a", permissions: ["memory:read", "memory:write"] };
    const embedding = { id: "test-embedding", async embed(input: string) { return [input.length, input.includes("Lunar") ? 1 : 0]; } };
    const app = await createApp(runtime, { auth: { async authenticate() { return principal; } }, embedding });
    const form = new FormData();
    form.set("file", new File(["Lunar keeps uploaded knowledge searchable."], "knowledge.md", { type: "text/markdown" }));
    form.set("expiresAt", new Date(Date.now() + 60_000).toISOString());
    form.set("namespace", "knowledge");

    const created = await app.handle(new Request("http://localhost/memories/upload", { method: "POST", body: form }));
    const payload = await created.json();
    const listed = await app.handle(new Request("http://localhost/memories?namespace=knowledge"));
    const page = await listed.json();

    expect(created.status).toBe(201);
    expect(payload).toMatchObject({ filename: "knowledge.md", chunks: 1, embedded: true });
    expect(page.records[0]).toMatchObject({ content: "Lunar keeps uploaded knowledge searchable.", tenantId: "tenant-a", embedding: expect.any(Array) });
    expect(page.records[0].metadata).toMatchObject({ filename: "knowledge.md", embeddingModel: "test-embedding" });
  });
  test("does not serve a GUI", async () => {
    const response = await (await createTestApp()).handle(new Request("http://localhost/"));

    expect(response.status).toBe(404);
  });

  test("returns a health response", async () => {
    const response = await (await createTestApp()).handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "lunar-elysia", status: "ok" });
  });

  test("returns token usage and throughput for completed runs", async () => {
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({
      name: "assistant",
      model: {
        id: "metered-model",
        capabilities: {},
        async call() {
          await Bun.sleep(10);
          return { text: "metered", toolCalls: [], usage: { inputTokens: 4, outputTokens: 6 } };
        },
      },
    }));
    const app = await createApp(runtime);

    const response = await app.handle(new Request("http://localhost/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: "hello" }),
    }));
    const body = await response.json();
    const stored = await app.handle(new Request(`http://localhost/runs/${body.runId}`));

    expect(body.usage).toEqual({ inputTokens: 4, outputTokens: 6, totalTokens: 10 });
    expect(body.metrics.durationMs).toBeGreaterThan(0);
    expect(body.metrics.outputTokensPerSecond).toBeGreaterThan(0);
    expect(body.metrics.modelOutputTokensPerSecond).toBeGreaterThan(0);
    expect((await stored.json()).usage).toEqual(body.usage);
  });

  test("aggregates token usage for a session", async () => {
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({
      name: "assistant",
      model: { id: "metered-model", capabilities: {}, async call() { return { text: "metered", toolCalls: [], usage: { inputTokens: 4, outputTokens: 6 } }; } },
    }));
    const app = await createApp(runtime);
    const request = (body: unknown) => app.handle(new Request("http://localhost/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }));

    const first = await request({ input: "first" });
    const { sessionId } = await first.json();
    await request({ input: "second", sessionId });
    const session = await app.handle(new Request(`http://localhost/sessions/${sessionId}`));
    const body = await session.json();

    expect(body.usage).toEqual({ inputTokens: 8, outputTokens: 12, totalTokens: 20 });
    expect(body.metrics.completedRuns).toBe(2);
  });

  test("returns 501 when streaming is unsupported", async () => {
    const response = await (await createTestApp()).handle(
      new Request("http://localhost/run/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "hello" }),
      }),
    );

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      error: "Streaming is not supported by the configured model",
      code: "STREAMING_UNSUPPORTED",
    });
  });

  test("streams lifecycle events and text deltas", async () => {
    const model: ModelProvider = {
      id: "streaming-api-model",
      capabilities: { streaming: true },
      async call() {
        throw new Error("buffered path should not be used");
      },
      async *stream() {
        yield { type: "text-delta", text: "hello" };
        yield { type: "response", response: { text: "hello", toolCalls: [] } };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));
    const app = await createApp(runtime);
    const response = await app.handle(
      new Request("http://localhost/run/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "hello" }),
      }),
    );
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(body).toContain("event: text.delta");
    expect(body).toContain('"text":"hello"');
    expect(body).toContain("event: run.completed");
    expect(body).toContain("event: stream.completed");
  });

  test("runs the assistant through the foundation runtime", async () => {
    const response = await (await createTestApp()).handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "hello" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.output).toBe("Test: hello");
    expect(body.runId).toEqual(expect.any(String));
    expect(body.sessionId).toEqual(expect.any(String));
  });

  test("runs and inspects a registered workflow", async () => {
    const runtime = await createRuntime();
    runtime.registerWorkflow(defineWorkflow({
      name: "hello-workflow",
      run: async (ctx) => ({ input: ctx.input }),
    }));
    const app = await createApp(runtime);
    const response = await app.handle(
      new Request("http://localhost/workflows/hello-workflow/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: { name: "Lunar" } }),
      }),
    );
    const body = await response.json();
    const inspected = await app.handle(new Request(`http://localhost/workflow-runs/${body.workflowRunId}`));

    expect(response.status).toBe(200);
    expect(body.status).toBe("completed");
    expect((await inspected.json()).output).toEqual({ input: { name: "Lunar" } });
  });

  test("executes the default Elysia tools", async () => {
    let calls = 0;
    const model: ModelProvider = {
      id: "tool-test",
      capabilities: { tools: true },
      async call({ messages }) {
        calls++;
        if (calls === 1) return { text: "", toolCalls: [{ id: "calc-1", name: "calculate", input: { expression: "2 + 3 * 4" } }] };
        expect(messages.at(-1)?.role).toBe("tool");
        expect(messages.at(-1)?.content).toBe("14");
        return { text: "The answer is 14.", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model, tools: [currentTimeTool, calculatorTool] }));
    const app = await createApp(runtime);
    const response = await app.handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "What is 2 + 3 * 4?" }),
      }),
    );

    expect(response.status).toBe(200);
    expect((await response.json()).output).toBe("The answer is 14.");
  });

  test("continues a session and exposes the run by id", async () => {
    const app = await createTestApp();
    const first = await app.handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "first" }),
      }),
    );
    const firstBody = await first.json();
    const second = await app.handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "second", sessionId: firstBody.sessionId }),
      }),
    );
    const secondBody = await second.json();
    const runResponse = await app.handle(new Request(`http://localhost/runs/${firstBody.runId}`));
    const storedRun = await runResponse.json();

    expect(second.status).toBe(200);
    expect(secondBody.sessionId).toBe(firstBody.sessionId);
    expect(runResponse.status).toBe(200);
    expect(storedRun.id).toBe(firstBody.runId);
    expect(storedRun.sessionId).toBe(firstBody.sessionId);
  });

  test("steers a session before the next run", async () => {
    const app = await createTestApp();
    const first = await app.handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "first" }),
      }),
    );
    const firstBody = await first.json();
    const steer = await app.handle(
      new Request(`http://localhost/sessions/${firstBody.sessionId}/steer`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "Be concise and use bullet points." }),
      }),
    );
    const steered = await steer.json();

    expect(steer.status).toBe(200);
    expect(steered).toEqual({ sessionId: firstBody.sessionId, steered: true });
  });

  test("accepts steering for an active session", async () => {
    let calls = 0;
    const model: ModelProvider = {
      id: "active-steering-api-model",
      capabilities: {},
      async call({ signal }) {
        calls++;
        if (calls === 1) {
          await new Promise<never>((_, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        return { text: "continued", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));
    const app = await createApp(runtime);
    const pending = runtime.run("assistant", "hello", { sessionId: "active-steering-session" });
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 0));

    const response = await app.handle(
      new Request("http://localhost/sessions/active-steering-session/steer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "Be concise." }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(202);
    expect(body).toMatchObject({
      status: "accepted",
      sessionId: "active-steering-session",
    });
    await expect(pending).rejects.toMatchObject({ code: "STEERED" });
    let continuation = await runtime.getStoredRun(body.continuationRunId);
    while (!continuation || continuation.status === "running" || continuation.status === "pending") {
      await new Promise((resolve) => setTimeout(resolve, 0));
      continuation = await runtime.getStoredRun(body.continuationRunId);
    }
    expect(continuation.status).toBe("completed");
  });

  test("emits an SSE interruption handoff for an active stream", async () => {
    let calls = 0;
    const model: ModelProvider = {
      id: "active-stream-steering-api-model",
      capabilities: { streaming: true },
      async call() {
        throw new Error("buffered path should not be used");
      },
      async *stream({ signal }) {
        calls++;
        if (calls === 1) {
          await new Promise<never>((_, reject) => {
            signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
          });
        }
        yield { type: "response", response: { text: "continued", toolCalls: [] } };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));
    const app = await createApp(runtime);
    const response = await app.handle(
      new Request("http://localhost/run/stream", {
        method: "POST",
        headers: { "content-type": "application/json", accept: "text/event-stream" },
        body: JSON.stringify({ input: "hello", sessionId: "active-stream-session" }),
      }),
    );
    const bodyPromise = response.text();
    while (calls === 0) await new Promise((resolve) => setTimeout(resolve, 0));

    const steer = await app.handle(
      new Request("http://localhost/sessions/active-stream-session/steer", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ instruction: "Be concise." }),
      }),
    );
    const body = await bodyPromise;

    expect(steer.status).toBe(202);
    expect(response.status).toBe(200);
    expect(body).toContain("event: stream.interrupted");
    expect(body).not.toContain("event: stream.error");
  });

  test("inspects a session", async () => {
    const app = await createTestApp();
    const run = await app.handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "hello" }),
      }),
    );
    const body = await run.json();
    const session = await app.handle(new Request(`http://localhost/sessions/${body.sessionId}`));

    expect(session.status).toBe(200);
    expect((await session.json()).history).toHaveLength(2);
  });

  test("approves a persisted tool request through the API", async () => {
    let calls = 0;
    const model: ModelProvider = {
      id: "approval-api-model",
      capabilities: { tools: true },
      async call({ messages }) {
        calls++;
        if (calls === 1) return { text: "", toolCalls: [{ id: "api-call", name: "dangerous", input: "x" }] };
        expect(messages.at(-1)?.role).toBe("tool");
        return { text: "approved", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({
      name: "assistant",
      model,
      tools: [{
        name: "dangerous",
        description: "Dangerous operation",
        schema: { parse: (input: unknown) => input, toJSONSchema: () => ({ type: "string" }) },
        permission: { requiresApproval: true },
        execute: () => "done",
      }],
    }));
    const app = await createApp(runtime);
    const first = await app.handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "hello" }),
      }),
    );
    const pending = await first.json();
    const approved = await app.handle(
      new Request(`http://localhost/runs/${pending.runId}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ approvalId: pending.pendingApproval.id }),
      }),
    );

    expect(first.status).toBe(200);
    expect(pending.status).toBe("waiting_approval");
    expect(approved.status).toBe(200);
    expect((await approved.json()).output).toBe("approved");
  });

  test("returns 404 for an unknown run", async () => {
    const response = await (await createTestApp()).handle(
      new Request("http://localhost/runs/does-not-exist"),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Run not found" });
  });

  test("rejects an invalid request body", async () => {
    const response = await (await createTestApp()).handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: 42 }),
      }),
    );

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "Invalid request" });
  });
});

test("returns 403 when a runtime policy denies an agent run", async () => {
  const runtime = await createRuntime({
    policyRules: [{ id: "maintenance", effect: "deny", action: "agent.run", name: "assistant" }],
  });
  runtime.registerAgent(defineAgent({ name: "assistant", model: testModel }));
  const app = await createApp(runtime);

  const response = await app.handle(new Request("http://localhost/run", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ input: "hello" }),
  }));

  expect(response.status).toBe(403);
  expect((await response.json()).error).toContain('Policy rule "maintenance" denied agent.run for "assistant"');
});
