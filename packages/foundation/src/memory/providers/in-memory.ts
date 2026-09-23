import type { MemoryProvider, MemoryRecord } from "../types";

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0, leftMagnitude = 0, rightMagnitude = 0;
  for (let index = 0; index < left.length; index++) {
    dot += left[index]! * right[index]!;
    leftMagnitude += left[index]! ** 2;
    rightMagnitude += right[index]! ** 2;
  }
  return leftMagnitude && rightMagnitude ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : 0;
}

export function createInMemoryProvider(id = "in-memory"): MemoryProvider {
  const records: MemoryRecord[] = [];

  return {
    id,
    capabilities: { semanticSearch: true, metadataFiltering: true, namespaces: true, deletion: true },
    async store(record) {
      const stored: MemoryRecord = { ...record, id: crypto.randomUUID(), createdAt: Date.now() };
      records.push(stored);
      return stored;
    },
    async retrieve(query) {
      const now = Date.now();
      const matched = records
        .filter((record) => query.embedding !== undefined || record.content.toLocaleLowerCase().includes(query.text.toLocaleLowerCase()))
        .filter((record) => record.expiresAt === undefined || record.expiresAt > now)
        .filter((record) => query.tenantId === undefined || record.tenantId === query.tenantId)
        .filter((record) => query.ownerId === undefined || record.ownerId === query.ownerId)
        .filter((record) => query.namespace === undefined || record.namespace === query.namespace)
        .filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value))
        .map((record) => query.embedding && record.embedding ? { ...record, score: cosineSimilarity(query.embedding, record.embedding) } : record)
        .filter((record) => query.embedding === undefined || record.embedding !== undefined)
        .filter((record) => query.minScore === undefined || (record.score ?? 1) >= query.minScore);
      return query.embedding ? matched.sort((left, right) => (right.score ?? 0) - (left.score ?? 0)).slice(0, query.limit ?? 10) : matched.slice(0, query.limit ?? 10);
    },
    async list(query) {
      const offset = query.cursor ? Number(query.cursor) : 0;
      const limit = Math.max(1, Math.min(query.limit ?? 50, 100));
      const matched = records
        .filter((record) => record.expiresAt === undefined || record.expiresAt > Date.now())
        .filter((record) => query.tenantId === undefined || record.tenantId === query.tenantId)
        .filter((record) => query.ownerId === undefined || record.ownerId === query.ownerId)
        .filter((record) => query.namespace === undefined || record.namespace === query.namespace)
        .filter((record) => query.filter === undefined || Object.entries(query.filter).every(([key, value]) => record.metadata?.[key] === value));
      const page = matched.slice(offset, offset + limit);
      return { records: page, ...(offset + page.length < matched.length ? { nextCursor: String(offset + page.length) } : {}) };
    },
    async delete(recordId, tenantId, ownerId) {
      const index = records.findIndex((record) => record.id === recordId && (tenantId === undefined || record.tenantId === tenantId) && (ownerId === undefined || record.ownerId === ownerId));
      if (index < 0) return false;
      records.splice(index, 1);
      return true;
    },
  };
}
