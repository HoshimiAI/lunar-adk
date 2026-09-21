export interface TraceSpan {
  id: string;
  name: string;
  startedAt: number;
  endedAt?: number;
  metadata?: Record<string, unknown>;
}

export function startSpan(name: string, metadata?: Record<string, unknown>): TraceSpan {
  return { id: crypto.randomUUID(), name, startedAt: Date.now(), metadata };
}

export function endSpan(span: TraceSpan): TraceSpan {
  return { ...span, endedAt: Date.now() };
}
