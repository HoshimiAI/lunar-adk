import { describe, expect, test } from "bun:test";
import { defineAgent } from "../agent";
import { createRuntime } from "../runtime";
import type { TelemetryRecord } from "./types";

function testModel() {
  return {
    id: "test-model",
    capabilities: { tools: false },
    async call() {
      return { text: "safe output", toolCalls: [], usage: { inputTokens: 2, outputTokens: 3 } };
    },
  };
}

describe("observability", () => {
  test("exports events and completed runs without affecting execution", async () => {
    const records: TelemetryRecord[] = [];
    const observed = await createRuntime({
      observability: { exporters: [{ export: (record) => records.push(record) }] },
    });
    observed.registerAgent(defineAgent({ name: "assistant", model: testModel() }));

    const result = await observed.run("assistant", "secret prompt");

    expect(result.output).toBe("safe output");
    expect(records.some((record) => record.type === "event" && record.event?.name === "run.started")).toBe(true);
    const completed = records.find((record) => record.type === "run");
    expect(completed?.run?.result).toBe("[redacted]");
    expect(completed?.run?.trace.some((span) => span.kind === "model" && span.status === "ok")).toBe(true);
    await observed.shutdown?.();
  });

  test("captures content only when explicitly enabled", async () => {
    const records: TelemetryRecord[] = [];
    const runtime = await createRuntime({
      observability: { captureContent: true, exporters: [{ export: (record) => records.push(record) }] },
    });
    runtime.registerAgent(defineAgent({ name: "assistant", model: testModel() }));
    await runtime.run("assistant", "visible prompt");

    const completed = records.find((record) => record.type === "run");
    expect(completed?.run?.result).toBe("safe output");
    await runtime.shutdown?.();
  });
});
