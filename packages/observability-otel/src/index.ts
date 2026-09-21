export interface TelemetrySpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: "agent" | "model" | "tool" | "workflow" | "internal";
  startedAt: number;
  endedAt?: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, string | number | boolean>;
  error?: string;
}

export interface TelemetryRecord {
  type: "event" | "run";
  event?: unknown;
  run?: { trace: TelemetrySpan[] };
}

export interface ObservabilityExporter {
  export(record: TelemetryRecord): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface ConsoleExporterOptions {
  logger?: (line: string) => void;
}

export function createConsoleExporter(options: ConsoleExporterOptions = {}): ObservabilityExporter {
  const logger = options.logger ?? console.log;
  return {
    export(record) {
      logger(JSON.stringify({ source: "lunar", ...record }));
    },
  };
}

export interface OTLPExporterOptions {
  endpoint: string;
  headers?: Record<string, string>;
  serviceName?: string;
  resourceAttributes?: Record<string, string | number | boolean>;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

function attributeValue(value: string | number | boolean): Record<string, unknown> {
  if (typeof value === "string") return { stringValue: value };
  if (typeof value === "boolean") return { boolValue: value };
  return { doubleValue: value };
}

function toOTLPSpan(span: TelemetrySpan) {
  return {
    traceId: span.traceId.replaceAll("-", "").padEnd(32, "0").slice(0, 32),
    spanId: span.id.replaceAll("-", "").padEnd(16, "0").slice(0, 16),
    parentSpanId: span.parentSpanId?.replaceAll("-", "").padEnd(16, "0").slice(0, 16),
    name: span.name,
    startTimeUnixNano: String(span.startedAt * 1_000_000),
    endTimeUnixNano: String((span.endedAt ?? span.startedAt) * 1_000_000),
    attributes: Object.entries(span.attributes).map(([key, value]) => ({ key, value: attributeValue(value) })),
    status: {
      code: span.status === "ok" ? 1 : span.status === "error" ? 2 : 0,
      message: span.error,
    },
  };
}

export function createOTLPExporter(options: OTLPExporterOptions): ObservabilityExporter {
  const send = options.fetch ?? globalThis.fetch;
  const resource = {
    attributes: Object.entries({ "service.name": options.serviceName ?? "lunar-adk", ...options.resourceAttributes } as Record<string, string | number | boolean>)
      .map(([key, value]) => ({ key, value: attributeValue(value) })),
  };
  let pending: Promise<void> = Promise.resolve();

  return {
    export(record) {
      if (record.type !== "run" || !record.run?.trace.length) return;
      const body = JSON.stringify({
        resourceSpans: [{ resource, scopeSpans: [{ scope: { name: "@lunar/observability-otel" }, spans: record.run.trace.map(toOTLPSpan) }] }],
      });
      pending = pending.then(async () => {
        const response = await send(options.endpoint, {
          method: "POST",
          headers: { "content-type": "application/json", ...options.headers },
          body,
        });
        if (!response.ok) throw new Error(`OTLP export failed with HTTP ${response.status}`);
      });
      return pending;
    },
    async shutdown() {
      await pending;
    },
  };
}
