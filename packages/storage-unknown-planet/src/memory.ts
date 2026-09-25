import type { MemoryListQuery, MemoryPage, MemoryProvider, MemoryQuery, MemoryRecord } from "@lunar/foundation/memory";
import type { JsonObject, MemoryRecord as PlanetMemoryRecord, Planet, PlanetScope } from "@unknown-planet/sdk";

const DEFAULT_PROVIDER_ID = "unknown-planet";
// Planet's cursor-based memory search clamps page sizes to 500.
const PAGE_LIMIT = 500;

type LunarMetadata = {
  namespace?: string;
  expiresAt?: number;
  metadata?: Record<string, unknown>;
};

export interface UnknownPlanetMemoryOptions {
  planet: Planet;
  scope: PlanetScope;
  id?: string;
}

function metadata(value: PlanetMemoryRecord): LunarMetadata {
  const stored = value.metadata.lunarAdk;
  return stored && typeof stored === "object" && !Array.isArray(stored) ? stored as LunarMetadata : {};
}

function record(value: PlanetMemoryRecord, tenantId: string, score?: number): MemoryRecord {
  const saved = metadata(value);
  return {
    id: value.id,
    content: value.content,
    ...(saved.metadata ? { metadata: saved.metadata } : {}),
    ...(saved.namespace === undefined ? {} : { namespace: saved.namespace }),
    tenantId,
    ...(value.userId === undefined ? {} : { ownerId: value.userId }),
    ...(saved.expiresAt === undefined ? {} : { expiresAt: saved.expiresAt }),
    ...(score === undefined ? {} : { score }),
    createdAt: value.createdAt.getTime(),
  };
}

function matches(value: MemoryRecord, query: MemoryQuery | MemoryListQuery): boolean {
  if (query.tenantId !== undefined && query.tenantId !== value.tenantId) return false;
  if (query.ownerId !== undefined && query.ownerId !== value.ownerId) return false;
  if (query.namespace !== undefined && query.namespace !== value.namespace) return false;
  if (query.filter && !Object.entries(query.filter).every(([key, expected]) => JSON.stringify(value.metadata?.[key]) === JSON.stringify(expected))) return false;
  return value.expiresAt === undefined || value.expiresAt > Date.now();
}

function validateScope(scope: PlanetScope): void {
  if (!scope.tenantId.trim()) throw new Error("Unknown Planet memory requires a tenantId.");
}

/** Adapts Planet's scoped memory and vector capabilities to Lunar's MemoryProvider contract. */
export function createUnknownPlanetMemoryProvider(options: UnknownPlanetMemoryOptions): MemoryProvider {
  validateScope(options.scope);
  const planet = options.planet.withScope(options.scope);
  const scopedTenantId = options.scope.tenantId;
  const providerId = options.id ?? DEFAULT_PROVIDER_ID;
  const agentId = `lunar-adk:${providerId}`;

  async function textPage(input: { text?: string; ownerId?: string; limit: number; cursor?: string; namespace?: string; filter?: Record<string, unknown> }): Promise<{ records: MemoryRecord[]; nextCursor?: string }> {
    const records: MemoryRecord[] = [];
    let cursor = input.cursor;
    while (records.length < input.limit) {
      const page = await planet.memory.searchPage({
        agentId,
        ...(input.ownerId === undefined ? {} : { userId: input.ownerId }),
        ...(input.text?.trim() ? { query: input.text } : {}),
        limit: Math.min(PAGE_LIMIT, input.limit - records.length),
        ...(cursor ? { cursor } : {}),
      });
      for (const item of page.items) {
        const mapped = record(item, scopedTenantId);
        if (matches(mapped, { tenantId: scopedTenantId, ownerId: input.ownerId, namespace: input.namespace, filter: input.filter })) records.push(mapped);
        if (records.length >= input.limit) break;
      }
      if (!page.nextCursor) return { records };
      cursor = page.nextCursor;
      if (page.items.length === 0) return { records };
    }
    return { records, ...(cursor ? { nextCursor: cursor } : {}) };
  }

  return {
    id: providerId,
    capabilities: { semanticSearch: true, embeddingOwner: "provider", metadataFiltering: true, namespaces: true, deletion: true },
    async store(input) {
      if (input.tenantId !== undefined && input.tenantId !== scopedTenantId) throw new Error("Memory tenantId does not match the configured Unknown Planet scope.");
      if (input.expiresAt !== undefined && (!Number.isFinite(input.expiresAt) || input.expiresAt <= Date.now())) throw new Error("Memory expiresAt must be in the future.");
      const id = crypto.randomUUID();
      const stored = await planet.memory.add({
        id,
        agentId,
        content: input.content,
        type: "fact",
        ...(input.ownerId === undefined ? {} : { userId: input.ownerId }),
        metadata: { lunarAdk: { namespace: input.namespace, expiresAt: input.expiresAt, metadata: input.metadata } } as JsonObject,
      });
      // Planet owns embedding and graph ingestion for content sent to its memory API.
      // ADK's optional precomputed embedding is intentionally not forwarded.
      return {
        id: stored.id,
        content: stored.content,
        ...(input.metadata ? { metadata: input.metadata } : {}),
        ...(input.namespace === undefined ? {} : { namespace: input.namespace }),
        tenantId: scopedTenantId,
        ...(input.ownerId === undefined ? {} : { ownerId: input.ownerId }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        createdAt: stored.createdAt.getTime(),
      };
    },
    async retrieve(query: MemoryQuery) {
      const limit = Math.max(0, Math.min(100, Math.floor(query.limit ?? 10)));
      if (limit === 0) return [];
      if (query.minScore !== undefined && query.minScore > 1) return [];
      const found = await planet.memory.search({
        agentId,
        ...(query.ownerId === undefined ? {} : { userId: query.ownerId }),
        ...(query.text.trim() ? { query: query.text } : {}),
        limit: PAGE_LIMIT,
      });
      const result = found.map((item) => record(item, scopedTenantId));
      const filtered = result.filter((item) => matchesMemory(item, query));
      return filtered.slice(0, limit);
    },
    async list(query: MemoryListQuery): Promise<MemoryPage> {
      const limit = Math.max(1, Math.min(100, Math.floor(query.limit ?? 50)));
      const result = await textPage({ ownerId: query.ownerId, limit, cursor: query.cursor, namespace: query.namespace, filter: query.filter });
      return { records: result.records, ...(result.nextCursor ? { nextCursor: result.nextCursor } : {}) };
    },
    async delete(id, tenantId, ownerId) {
      if (tenantId !== undefined && tenantId !== scopedTenantId) return false;
      const current = await planet.memory.get(id);
      if (!current || (ownerId !== undefined && current.userId !== ownerId)) return false;
      return planet.memory.delete(id);
    },
  };
}

function matchesMemory(value: MemoryRecord, query: MemoryQuery): boolean {
  if (query.tenantId !== undefined && query.tenantId !== value.tenantId) return false;
  if (query.ownerId !== undefined && query.ownerId !== value.ownerId) return false;
  if (query.namespace !== undefined && query.namespace !== value.namespace) return false;
  if (query.filter && !Object.entries(query.filter).every(([key, expected]) => JSON.stringify(value.metadata?.[key]) === JSON.stringify(expected))) return false;
  return value.expiresAt === undefined || value.expiresAt > Date.now();
}
