import type { MemoryProvider, MemoryRecord } from "../types";

export function createInMemoryProvider(id = "in-memory"): MemoryProvider {
  const records: MemoryRecord[] = [];

  return {
    id,
    async store(record) {
      const stored: MemoryRecord = { ...record, id: crypto.randomUUID(), createdAt: Date.now() };
      records.push(stored);
      return stored;
    },
    async retrieve(query) {
      return records.filter((r) => r.content.includes(query.text)).slice(0, query.limit ?? 10);
    },
  };
}
