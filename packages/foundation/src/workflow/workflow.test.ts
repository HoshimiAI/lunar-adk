import { expect, test } from "bun:test";
import { createRuntime, defineAgent } from "../index";
import type { ModelProvider } from "../model";
import { defineWorkflow, InMemoryWorkflowStore } from "./index";

const model: ModelProvider = {
  id: "workflow-test-model",
  capabilities: {},
  async call({ messages }) {
    return { text: `child:${messages.at(-1)?.content ?? ""}`, toolCalls: [] };
  },
};

test("runs code-first workflows and persists managed child runs", async () => {
  const runtime = await createRuntime();
  runtime.registerAgent(defineAgent({ name: "analyst", model }));
  runtime.registerWorkflow(defineWorkflow({
    name: "research",
    run: async (ctx) => {
      const result = await ctx.runSubAgent("analyst", "analyze");
      await ctx.checkpoint("analysis-complete", { output: result.output });
      return { answer: result.output };
    },
  }));

  const run = await runtime.runWorkflow("research", { topic: "Bun" });
  const stored = await runtime.getWorkflowRun(run.id);
  const child = await runtime.getStoredRun(run.childRunIds[0]!);

  expect(run.status).toBe("completed");
  expect(run.output).toEqual({ answer: "child:analyze" });
  expect(stored?.checkpoints[0]?.name).toBe("analysis-complete");
  expect(child?.parentRunId).toBe(run.id);
});

test("pauses a code-first workflow for approval and resumes it", async () => {
  const runtime = await createRuntime();
  let executions = 0;
  runtime.registerWorkflow(defineWorkflow({
    name: "publish",
    run: async (ctx) => {
      executions++;
      await ctx.requestApproval("publish", "Publish the result?");
      return { published: true, executions };
    },
  }));

  const pending = await runtime.runWorkflow("publish");
  expect(pending.status).toBe("waiting_approval");
  const resumed = await runtime.resumeWorkflow(pending.id, "publish");

  expect(resumed.status).toBe("completed");
  expect(resumed.output).toEqual({ published: true, executions: 2 });
});

test("resumes a failed workflow from its latest checkpoint", async () => {
  const store = new InMemoryWorkflowStore();
  const workflow = defineWorkflow({
    name: "restartable",
    run: async (ctx) => {
      if (ctx.resumeFrom?.name === "phase-one") return "recovered";
      await ctx.checkpoint("phase-one", { complete: true });
      throw new Error("simulated process failure");
    },
  });
  const firstRuntime = await createRuntime({ workflowStore: store });
  firstRuntime.registerWorkflow(workflow);
  const failed = await firstRuntime.runWorkflow("restartable");

  const secondRuntime = await createRuntime({ workflowStore: store });
  secondRuntime.registerWorkflow(workflow);
  const resumed = await secondRuntime.resumeWorkflow(failed.id);

  expect(failed.status).toBe("failed");
  expect(resumed.status).toBe("completed");
  expect(resumed.output).toBe("recovered");
});
