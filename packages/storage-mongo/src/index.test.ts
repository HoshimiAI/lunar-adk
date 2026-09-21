import { expect, test } from "bun:test";
import { createMongoStores, type MongoCollection, type MongoDatabase } from "./index";

test("maps stores to Mongo collections with upsert semantics", async () => {
  const data = new Map<string, Map<string, unknown>>();
  const database: MongoDatabase = {
    collection<T>(name: string): MongoCollection<T> {
      const collection = data.get(name) ?? new Map<string, unknown>();
      data.set(name, collection);
      return {
        async replaceOne(filter, replacement) {
          collection.set(filter.id, replacement);
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
});
