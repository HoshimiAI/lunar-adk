import { describe, expect, test } from "bun:test";
import { AgentRunError, createRuntime, defineAgent, defineTool } from "../index";
import type { ModelProvider } from "../model";

const stringSchema = {
  parse(input: unknown) {
    if (typeof input !== "string") throw new Error("Expected a string");
    return input;
  },
  toJSONSchema: () => ({ type: "string" }),
};

describe("foundation runtime", () => {
  test("persists lifecycle events on a successful run", async () => {
    const model: ModelProvider = {
      id: "success",
      capabilities: {},
      async call() {
        return { text: "done", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));

    const result = await runtime.run("assistant", "hello");
    const stored = await runtime.getStoredRun(result.run.id);

    expect(result.output).toBe("done");
    expect(stored?.status).toBe("completed");
    expect(stored?.events.map((event) => event.name)).toEqual([
      "run.started",
      "agent.started",
      "model.called",
      "agent.completed",
      "run.completed",
    ]);
  });

  test("executes tools and reports tool failures without crashing the loop", async () => {
    let calls = 0;
    const model: ModelProvider = {
      id: "tool-model",
      capabilities: { tools: true },
      async call({ messages }) {
        calls++;
        if (calls === 1) {
          return {
            text: "",
            toolCalls: [{ id: "call-1", name: "upper", input: "hello" }],
          };
        }
        expect(messages.at(-1)?.content).toBe("HELLO");
        return { text: "finished", toolCalls: [] };
      },
    };
    const tool = defineTool({
      name: "upper",
      description: "Uppercase text",
      schema: stringSchema,
      execute: (input: string) => input.toUpperCase(),
    });
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model, tools: [tool] }));

    const result = await runtime.run("assistant", "hello");

    expect(result.output).toBe("finished");
    expect(result.run.events.map((event) => event.name)).toContain("tool.completed");
  });

  test("persists a failed run when the model exceeds tool rounds", async () => {
    const model: ModelProvider = {
      id: "looping",
      capabilities: { tools: true },
      async call() {
        return { text: "again", toolCalls: [{ id: "call", name: "missing", input: null }] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model, maxToolRoundtrips: 1 }));

    let error: unknown;
    try {
      await runtime.run("assistant", "hello");
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AgentRunError);
    expect((error as AgentRunError).code).toBe("MAX_TOOL_ROUNDS");
    const failed = await runtime.getStoredRun((error as AgentRunError).run.id);
    expect(failed?.status).toBe("failed");
    expect(failed?.events.map((event) => event.name)).toContain("run.failed");
  });

  test("retries a transient model failure", async () => {
    let attempts = 0;
    const model: ModelProvider = {
      id: "retrying",
      capabilities: {},
      async call() {
        attempts++;
        if (attempts === 1) throw new Error("temporary");
        return { text: "recovered", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(
      defineAgent({
        name: "assistant",
        model,
        retryPolicy: { maxAttempts: 2, backoffMs: () => 0 },
      }),
    );

    const result = await runtime.run("assistant", "hello");

    expect(result.output).toBe("recovered");
    expect(attempts).toBe(2);
  });

  test("fails with an inspectable run when cancelled before execution", async () => {
    let calls = 0;
    const model: ModelProvider = {
      id: "cancelled",
      capabilities: {},
      async call() {
        calls++;
        return { text: "should not run", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));
    const controller = new AbortController();
    controller.abort();

    let error: unknown;
    try {
      await runtime.run("assistant", "hello", { signal: controller.signal });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(AgentRunError);
    expect((error as AgentRunError).code).toBe("CANCELLED");
    expect((error as AgentRunError).run.error).toMatch(/aborted/);
    expect(calls).toBe(0);
  });

  test("reuses session history on the next run", async () => {
    const prompts: string[] = [];
    const model: ModelProvider = {
      id: "session-model",
      capabilities: {},
      async call({ messages }) {
        prompts.push(messages.map((message) => message.content).join("|"));
        return { text: `reply-${prompts.length}`, toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));

    const first = await runtime.run("assistant", "first");
    await runtime.run("assistant", "second", { sessionId: first.run.sessionId });

    expect(prompts).toEqual(["first", "first|reply-1|second"]);
  });

  test("applies a steering instruction to the next run", async () => {
    const prompts: string[][] = [];
    const model: ModelProvider = {
      id: "steering-model",
      capabilities: {},
      async call({ messages }) {
        prompts.push(messages.map((message) => `${message.role}:${message.content}`));
        return { text: "ok", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));
    const first = await runtime.run("assistant", "first");

    await runtime.steer(first.run.sessionId!, "Use short answers.");
    await runtime.run("assistant", "second", { sessionId: first.run.sessionId });

    expect(prompts[1]).toContain("system:Use short answers.");
  });

  test("pauses and resumes approval-required tools", async () => {
    let executed = false;
    let calls = 0;
    const model: ModelProvider = {
      id: "approval-model",
      capabilities: { tools: true },
      async call({ messages }) {
        calls++;
        if (calls === 1) {
          return { text: "", toolCalls: [{ id: "approval-call", name: "dangerous", input: "x" }] };
        }
        expect(messages.at(-1)?.role).toBe("tool");
        expect(messages.at(-1)?.content).toBe("should not run");
        return { text: "approved", toolCalls: [] };
      },
    };
    const tool = defineTool({
      name: "dangerous",
      description: "Requires approval",
      schema: stringSchema,
      permission: { requiresApproval: true },
      execute: () => {
        executed = true;
        return "should not run";
      },
    });
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model, tools: [tool] }));

    const result = await runtime.run("assistant", "hello");

    expect(result.output).toBe("");
    expect(result.run.status).toBe("waiting_approval");
    expect(result.run.pendingApproval?.toolName).toBe("dangerous");
    expect(executed).toBe(false);
    expect(result.run.events.map((event) => event.name)).toContain("tool.approval_required");

    const resumed = await runtime.approve(result.run.id, result.run.pendingApproval!.id);
    expect(resumed.output).toBe("approved");
    expect(resumed.run.status).toBe("completed");
    expect(executed).toBe(true);
  });

  test("publishes agent events through the runtime bus", async () => {
    const seen: string[] = [];
    const model: ModelProvider = {
      id: "events-model",
      capabilities: {},
      async call() {
        return { text: "done", toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.on("model.called", (event) => seen.push(event.name));
    runtime.registerAgent(defineAgent({ name: "assistant", model }));

    await runtime.run("assistant", "hello");

    expect(seen).toEqual(["model.called"]);
  });

  test("cancels an active run through the runtime", async () => {
    let runId: string | undefined;
    const model: ModelProvider = {
      id: "active-cancel-model",
      capabilities: {},
      async call({ signal }) {
        await new Promise<never>((_, reject) => {
          signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
        throw new Error("unreachable");
      },
    };
    const runtime = await createRuntime();
    runtime.on("run.started", (event) => {
      runId = (event.payload as { runId: string }).runId;
    });
    runtime.registerAgent(defineAgent({ name: "assistant", model }));
    const pending = runtime.run("assistant", "hello");
    await new Promise((resolve) => setTimeout(resolve, 0));
    const cancelled = await runtime.cancel(runId!);

    expect(cancelled?.status).toBe("cancelled");
    await expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
  });

  test("serializes concurrent runs for one session", async () => {
    const prompts: string[] = [];
    const model: ModelProvider = {
      id: "serialized-model",
      capabilities: {},
      async call({ messages }) {
        prompts.push(messages.map((message) => message.content).join("|"));
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { text: `reply-${messages.at(-1)?.content}`, toolCalls: [] };
      },
    };
    const runtime = await createRuntime();
    runtime.registerAgent(defineAgent({ name: "assistant", model }));
    const sessionId = "shared-session";

    await Promise.all([
      runtime.run("assistant", "one", { sessionId }),
      runtime.run("assistant", "two", { sessionId }),
    ]);
    const session = await runtime.getSession(sessionId);

    expect(prompts).toHaveLength(2);
    expect(session?.history).toHaveLength(4);
    expect(session?.runs).toHaveLength(2);
  });
});
