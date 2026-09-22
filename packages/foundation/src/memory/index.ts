import type { MemoryProvider } from "./types";

export { MemoryRegistry } from "./registry";
export { createInMemoryProvider } from "./providers/in-memory";
export type { EmbeddingProvider, MemoryCapabilities, MemoryProvider, MemoryRecord, MemoryQuery, MemoryListQuery, MemoryPage } from "./types";
export type { MemoryStore } from "./store";

export function createMemory(provider: MemoryProvider): MemoryProvider {
  return provider;
}
