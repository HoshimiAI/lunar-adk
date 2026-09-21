import { describe, expect, test } from "bun:test";
import { createRuntime, defineAgent, defineTool } from "@lunar/adk";
import type { ModelProvider } from "@lunar/adk";
import { createApp } from "./app";

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
  test("returns a health response", async () => {
    const response = await (await createTestApp()).handle(new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ name: "lunar-elysia", status: "ok" });
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
