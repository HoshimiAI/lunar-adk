import type { MemoryProvider, MemoryRecord } from "../types";

export function createInMemoryProvider(id = "in-memory"): MemoryProvider {
  const records: MemoryRecord[] = [];

  return {
    id,
    capabilities: { metadataFiltering: true, namespaces: true, deletion: true },
    async store(record) {
      const stored: MemoryRecord = { ...record, id: crypto.randomUUID(), createdAt: Date.now() };
      records.push(stored);
      return stored;
    },
    async retrieve(query) {
      return records
        .filter((record) => record.content.includes(query.text))
        .filter((record) => query.namespace === undefined || record.namespace === query.namespace)
        .filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value))
        .filter((record) => query.minScore === undefined || (record.score ?? 1) >= query.minScore)
        .slice(0, query.limit ?? 10);
    },
    async delete(recordId) {
      const index = records.findIndex((record) => record.id === recordId);
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
  };
}
