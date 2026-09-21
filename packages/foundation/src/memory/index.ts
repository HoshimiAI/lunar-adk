import type { MemoryProvider } from "./types";

export { MemoryRegistry } from "./registry";
export { createInMemoryProvider } from "./providers/in-memory";
export type { MemoryProvider, MemoryRecord, MemoryQuery } from "./types";
export type { MemoryStore } from "./store";

export function createMemory(provider: MemoryProvider): MemoryProvider {
  return provider;
}
