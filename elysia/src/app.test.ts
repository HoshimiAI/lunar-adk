import { describe, expect, test } from "bun:test";
import { createRuntime, defineAgent } from "@lunar/adk";
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
