import { expect, test } from "bun:test";
import { createConsoleExporter, createOTLPExporter } from "./index";

test("console exporter emits structured records", async () => {
  const lines: string[] = [];
  const exporter = createConsoleExporter({ logger: (line) => lines.push(line) });
  await exporter.export({ type: "event", event: { name: "run.started" } });
  expect(JSON.parse(lines[0]!)).toEqual({ source: "lunar", type: "event", event: { name: "run.started" } });
});

test("OTLP exporter maps run spans and flushes on shutdown", async () => {
  const requests: Request[] = [];
  const exporter = createOTLPExporter({
    endpoint: "https://collector.example/v1/traces",
    fetch: async (_input, init) => {
      requests.push(new Request("https://collector.example/v1/traces", init));
      return new Response(null, { status: 200 });
    },
  });
  await exporter.export({
    type: "run",
    run: {
      trace: [{
        id: "span-id",
        traceId: "trace-id",
        name: "model.test",
        kind: "model",
        startedAt: 1,
        endedAt: 2,
        status: "ok",
        attributes: { "lunar.model": "test" },
      }],
    },
  });
  await exporter.shutdown?.();
  const payload = await requests[0]!.json() as { resourceSpans: Array<{ scopeSpans: Array<{ spans: Array<{ name: string }> }> }> };
  expect(payload.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.name).toBe("model.test");
});
