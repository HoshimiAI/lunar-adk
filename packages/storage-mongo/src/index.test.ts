import { expect, test } from "bun:test";
import { createMongoStores, type MongoCollection, type MongoDatabase } from "./index";
import { verifyStorageBundle } from "@lunar/foundation/storage/testing";

test("maps stores to Mongo collections with revision-safe semantics", async () => {
  const data = new Map<string, Map<string, unknown>>();
  const database: MongoDatabase = {
    collection<T>(name: string): MongoCollection<T> {
      const collection = data.get(name) ?? new Map<string, unknown>();
      data.set(name, collection);
      return {
        async insertOne(document) {
          if (collection.has((document as { id: string }).id)) throw Object.assign(new Error("duplicate"), { code: 11000 });
          collection.set((document as { id: string }).id, document);
        },
        async replaceOne(filter, replacement) {
          const current = collection.get(filter.id as string) as { revision?: number } | undefined;
          const expected = "revision" in filter ? filter.revision : undefined;
          const legacyExpected = "$or" in filter;
          const matches = current !== undefined && (legacyExpected
            ? (current.revision ?? 0) === 0
            : current.revision === expected);
          if (!matches) return { matchedCount: 0 };
          collection.set(filter.id as string, replacement);
          return { matchedCount: 1 };
        },
        async findOne(filter) {
          return (collection.get(filter.id) as T | undefined) ?? null;
        },
      };
    },
  };
  const stores = createMongoStores({ database, collectionPrefix: "test" });
  await stores.sessionStore.save({ id: "session-1", history: [], runs: [] });

  expect((await stores.sessionStore.get("session-1"))?.id).toBe("session-1");
  expect(data.has("test_sessions")).toBe(true);
  await verifyStorageBundle(stores);
});
