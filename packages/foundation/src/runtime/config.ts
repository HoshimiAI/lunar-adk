import type { RuntimeConfig } from "./types";

export function resolveConfig(config: RuntimeConfig = {}): Required<Pick<RuntimeConfig, "plugins">> {
  return { plugins: config.plugins ?? [] };
}
