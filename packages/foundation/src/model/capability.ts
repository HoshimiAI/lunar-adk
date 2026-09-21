import type { ModelCapabilities } from "./types";

export function supports(capabilities: ModelCapabilities, feature: keyof ModelCapabilities): boolean {
  return Boolean(capabilities[feature]);
}
