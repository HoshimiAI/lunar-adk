import type { RuntimeConfig } from "./types";

export function resolveConfig(config: RuntimeConfig = {}): Required<RuntimeConfig> {
  return { plugins: config.plugins ?? [] };
}
