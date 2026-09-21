export interface TraceSpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: "agent" | "model" | "tool" | "workflow" | "internal";
  startedAt: number;
  endedAt?: number;
  status: "ok" | "error" | "unset";
  attributes: Record<string, string | number | boolean>;
  metadata?: Record<string, unknown>;
  error?: string;
}

export function startSpan(
  name: string,
  kindOrMetadata: TraceSpan["kind"] | Record<string, unknown> = "internal",
  traceId: string = crypto.randomUUID(),
  parentSpanId?: string,
  attributes: Record<string, string | number | boolean> = {},
): TraceSpan {
  if (typeof kindOrMetadata === "object") {
    const metadata = kindOrMetadata;
    const primitiveAttributes = Object.fromEntries(
      Object.entries(metadata).filter(([, value]) => ["string", "number", "boolean"].includes(typeof value)),
    ) as Record<string, string | number | boolean>;
    return { id: crypto.randomUUID(), traceId, name, kind: "internal", startedAt: Date.now(), status: "unset", attributes: primitiveAttributes, metadata };
  }
  return { id: crypto.randomUUID(), traceId, parentSpanId, name, kind: kindOrMetadata, startedAt: Date.now(), status: "unset", attributes };
}

export function endSpan(span: TraceSpan, status: TraceSpan["status"] = "ok", error?: string): TraceSpan {
  return { ...span, endedAt: Date.now(), status, error };
}
