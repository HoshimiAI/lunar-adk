import type { LunarEvent } from "../event";
import type { Run } from "../run";
import type { ObservabilityConfig, ObservabilityExporter, TelemetryRecord } from "./types";

function redact(value: unknown, captureContent: boolean, key = ""): unknown {
  if (captureContent) return value;
  if (/^(content|input|output|result|messages|toolCalls|continuation)$/i.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.map((item) => redact(item, captureContent));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([entryKey, entryValue]) => [entryKey, redact(entryValue, captureContent, entryKey)]));
  }
  return value;
}

export class ObservabilityHub {
  private readonly exporters: ObservabilityExporter[];
  private readonly captureContent: boolean;

  constructor(config: ObservabilityConfig = {}) {
    this.exporters = config.exporters ?? [];
    this.captureContent = config.captureContent === true;
  }

  recordEvent(event: LunarEvent): void {
    if (this.exporters.length === 0) return;
    const safeEvent = { ...event, payload: redact(event.payload, this.captureContent) } as LunarEvent;
    this.publish({ type: "event", event: safeEvent });
  }

  recordRun(run: Run): void {
    if (this.exporters.length === 0) return;
    this.publish({ type: "run", run: redact(run, this.captureContent) as Run });
  }

  async shutdown(): Promise<void> {
    await Promise.all(this.exporters.map(async (exporter) => {
      try {
        await exporter.shutdown?.();
      } catch {
        // Telemetry shutdown must never affect application shutdown.
      }
    }));
  }

  private publish(record: TelemetryRecord): void {
    for (const exporter of this.exporters) {
      try {
        void Promise.resolve(exporter.export(record)).catch(() => undefined);
      } catch {
        // Exporters are isolated from agent execution.
      }
    }
  }
}
