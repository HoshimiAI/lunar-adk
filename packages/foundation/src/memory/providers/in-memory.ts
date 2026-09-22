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
        .filter((record) => record.expiresAt === undefined || record.expiresAt > Date.now())
        .filter((record) => query.tenantId === undefined || record.tenantId === query.tenantId)
        .filter((record) => query.namespace === undefined || record.namespace === query.namespace)
        .filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value))
        .filter((record) => query.minScore === undefined || (record.score ?? 1) >= query.minScore)
        .slice(0, query.limit ?? 10);
    },
    async list(query) {
      const offset = query.cursor ? Number(query.cursor) : 0;
      const limit = Math.max(1, Math.min(query.limit ?? 50, 100));
      const matched = records
        .filter((record) => record.expiresAt === undefined || record.expiresAt > Date.now())
        .filter((record) => query.tenantId === undefined || record.tenantId === query.tenantId)
        .filter((record) => query.namespace === undefined || record.namespace === query.namespace)
        .filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value));
      const page = matched.slice(offset, offset + limit);
      return { records: page, ...(offset + page.length < matched.length ? { nextCursor: String(offset + page.length) } : {}) };
    },
    async delete(recordId, tenantId) {
      const index = records.findIndex((record) => record.id === recordId && (tenantId === undefined || record.tenantId === tenantId));
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
  };
}
