import { describe, expect, test } from "bun:test";
import { createRuntime, defineAgent, defineTool, defineWorkflow } from "@lunar/adk";
import type { ModelProvider } from "@lunar/adk";
import { createApp, createAppWithBetterAuth } from "./app";
import { calculatorTool, currentTimeTool } from "./tools";

const testModel: ModelProvider = {
  id: "test",
  capabilities: {},
  async call({ messages }) {
    return { text: `Test: ${messages.at(-1)?.content ?? ""}`, toolCalls: [] };
  },
};

async function createTestApp() {
  const runtime = await createRuntime();
  runtime.registerAgent(
    defineAgent({ name: "assistant", model: testModel, systemPrompt: "Test assistant" }),
  );
  return createApp(runtime);
}

describe("Elysia app", () => {
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
  test("does not serve a GUI", async () => {
    const response = await (await createTestApp()).handle(new Request("http://localhost/"));

    expect(response.status).toBe(404);
  });

  test("returns a health response", async () => {
    const response = await (await createTestApp()).handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "lunar-elysia", status: "ok" });
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
