export { ModelRegistry } from "./registry";
export { supports } from "./capability";
export type {
  ModelProvider,
  ModelCapabilities,
  ModelMessage,
  ModelToolCall,
  ModelResponse,
  ModelCallOptions,
} from "./types";

export function defineModelProvider(provider: import("./types").ModelProvider) {
  return provider;
}
