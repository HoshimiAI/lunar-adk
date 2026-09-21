import type { LunarEvent } from "../event";
import type { Run } from "../run";

export type TelemetryStatus = "ok" | "error" | "unset";

export interface TelemetrySpan {
  id: string;
  traceId: string;
  parentSpanId?: string;
  name: string;
  kind: "agent" | "model" | "tool" | "workflow" | "internal";
  startedAt: number;
  endedAt?: number;
  status: TelemetryStatus;
  attributes: Record<string, string | number | boolean>;
  error?: string;
}

export interface TelemetryRecord {
  type: "event" | "run";
  event?: LunarEvent;
  run?: Run;
  spans?: TelemetrySpan[];
}

export interface ObservabilityExporter {
  export(record: TelemetryRecord): void | Promise<void>;
  shutdown?(): void | Promise<void>;
}

export interface ObservabilityConfig {
  exporters?: ObservabilityExporter[];
  captureContent?: boolean;
}
