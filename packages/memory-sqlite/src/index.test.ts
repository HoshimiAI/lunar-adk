import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { createSqliteMemoryProvider } from "./index";

describe("createSqliteMemoryProvider", () => {
  test("persists records and retrieves them using substring matching", async () => {
    const database = new Database(":memory:");
    const first = createSqliteMemoryProvider(database);
    const stored = await first.store({ content: "Bun makes TypeScript fast", metadata: { source: "test" } });
    const second = createSqliteMemoryProvider(database);

    expect(await second.retrieve({ text: "TypeScript" })).toEqual([stored]);
    expect((await second.retrieve({ text: "TypeScript" }))[0]?.metadata).toEqual({ source: "test" });
    first.close();
    second.close();
  });

  test("honors limits and treats LIKE characters as literal text", async () => {
    const provider = createSqliteMemoryProvider(new Database(":memory:"));
    await provider.store({ content: "100% complete" });
    await provider.store({ content: "100 percent complete" });
    await provider.store({ content: "another 100% complete" });

    expect((await provider.retrieve({ text: "100%", limit: 1 })).map((record) => record.content)).toEqual(["100% complete"]);
    provider.close();
  });

  test("supports namespaces, metadata filters, and deletion", async () => {
    const provider = createSqliteMemoryProvider(new Database(":memory:"));
    const kept = await provider.store({ content: "shared text", namespace: "one", metadata: { tenant: "a" } });
    await provider.store({ content: "shared text", namespace: "two", metadata: { tenant: "b" } });

    expect(await provider.retrieve({ text: "shared", namespace: "one", filter: { tenant: "a" } })).toHaveLength(1);
    expect(await provider.delete?.(kept.id)).toBe(true);
    expect(await provider.retrieve({ text: "shared", namespace: "one" })).toEqual([]);
    provider.close();
  });
});
