import { expect, test } from "bun:test";
import type { MemoryRecord as PlanetMemoryRecord, Planet } from "@unknown-planet/sdk";
import { createUnknownPlanetMemoryProvider } from "./memory.js";

test("routes raw ADK memory content through Planet-owned embedding and search", async () => {
  const now = new Date();
  let saved: PlanetMemoryRecord | undefined;
  let addCalls = 0;
  let addInput: Record<string, unknown> | undefined;
  let searchInput: Record<string, unknown> | undefined;
  const planetMemory = {
    async add(input: Record<string, unknown>) {
      addCalls += 1;
      addInput = input;
      saved = {
        id: String(input.id),
        agentId: String(input.agentId),
        content: String(input.content),
        type: "fact",
        userId: input.userId as string | undefined,
        metadata: input.metadata as PlanetMemoryRecord["metadata"],
        createdAt: now,
        updatedAt: now,
      };
      return saved;
    },
    async search(input: Record<string, unknown>) {
      searchInput = input;
      return saved ? [saved] : [];
    },
    async searchPage() {
      return { items: saved ? [saved] : [], nextCursor: undefined };
    },
    async get(id: string) { return saved?.id === id ? saved : null; },
    async delete(id: string) { return saved?.id === id; },
  };
  const planet = {
    withScope() { return { memory: planetMemory }; },
  } as unknown as Planet;
  const provider = createUnknownPlanetMemoryProvider({ planet, scope: { tenantId: "tenant-a" } });
  const adkEmbedding = [9, 9, 9];

  const stored = await provider.store({
    content: "The user prefers concise answers.",
    tenantId: "tenant-a",
    ownerId: "user-a",
    namespace: "preferences",
    metadata: { source: "profile" },
    embedding: adkEmbedding,
  });
  const found = await provider.retrieve({
    text: "preferred answer length",
    tenantId: "tenant-a",
    ownerId: "user-a",
    namespace: "preferences",
    embedding: adkEmbedding,
  });

  expect(addCalls).toBe(1);
  expect(addInput).toMatchObject({ content: "The user prefers concise answers.", agentId: "lunar-adk:unknown-planet", userId: "user-a" });
  expect(addInput).not.toHaveProperty("embedding");
  expect(searchInput).toMatchObject({ query: "preferred answer length", agentId: "lunar-adk:unknown-planet", userId: "user-a" });
  expect(searchInput).not.toHaveProperty("embedding");
  expect(stored).not.toHaveProperty("embedding");
  expect(found).toHaveLength(1);
  expect(found[0]).toMatchObject({ id: stored.id, namespace: "preferences", ownerId: "user-a", metadata: { source: "profile" } });
});

test("uses Planet memory deletion for its vector and graph cleanup", async () => {
  const now = new Date();
  const removed: string[] = [];
  const current: PlanetMemoryRecord = { id: "m1", agentId: "a1", content: "content", type: "fact", userId: "user-a", metadata: {}, createdAt: now, updatedAt: now };
  const planet = {
    withScope() {
      return { memory: { async get() { return current; }, async delete(id: string) { removed.push(id); return true; } } };
    },
  } as unknown as Planet;
  const provider = createUnknownPlanetMemoryProvider({ planet, scope: { tenantId: "tenant-a" } });

  await expect(provider.delete!("m1", "tenant-a", "user-a")).resolves.toBe(true);
  expect(removed).toEqual(["m1"]);
});

test("a Lunar vector cannot substitute for Planet embedding configuration", async () => {
  const planet = {
    withScope() {
      return { memory: { async add() { throw new Error("Planet was created without an EmbeddingProvider provider."); } } };
    },
  } as unknown as Planet;
  const provider = createUnknownPlanetMemoryProvider({ planet, scope: { tenantId: "tenant-a" } });

  await expect(provider.store({ content: "raw memory", tenantId: "tenant-a", embedding: [1, 0] }))
    .rejects.toThrow("Planet was created without an EmbeddingProvider provider.");
});

test("Planet memory ingestion works when ADK supplies no precomputed vector", async () => {
  let receivedContent = "";
  const now = new Date();
  const planet = {
    withScope() {
      return { memory: { async add(input: Record<string, unknown>) {
        receivedContent = String(input.content);
        return { id: String(input.id), agentId: String(input.agentId), content: receivedContent, type: "fact", metadata: {}, createdAt: now, updatedAt: now };
      } } };
    },
  } as unknown as Planet;
  const provider = createUnknownPlanetMemoryProvider({ planet, scope: { tenantId: "tenant-a" } });

  const saved = await provider.store({ content: "Planet embeds this", tenantId: "tenant-a" });

  expect(receivedContent).toBe("Planet embeds this");
  expect(saved.content).toBe("Planet embeds this");
  expect(saved).not.toHaveProperty("embedding");
});
