import { expect, test } from "bun:test";
import { createHttpStores, HttpStorageError } from "./index";

test("persists and reads records through the HTTP contract", async () => {
  const records = new Map<string, unknown>();
  const requests: Request[] = [];
  const stores = createHttpStores({
    baseUrl: "https://storage.example/",
    token: "secret",
    headers: { "x-tenant": "tenant-1" },
    fetch: async (input, init) => {
      const request = new Request(input as string, init);
      requests.push(request);
      const url = new URL(request.url);
      const key = url.pathname;
      if (request.method === "PUT") {
        records.set(key, await request.json());
        return new Response(null, { status: 204 });
      }
      const value = records.get(key);
      return value === undefined
        ? new Response(null, { status: 404 })
        : Response.json(value);
    },
  });

  await stores.runStore.save({ id: "run-1", status: "completed", startedAt: 1, events: [], trace: [], artifacts: [], usage: { inputTokens: 0, outputTokens: 0 } });
  const restored = await stores.runStore.get("run-1");

  expect(restored?.id).toBe("run-1");
  expect(requests[0]?.headers.get("authorization")).toBe("Bearer secret");
  expect(requests[0]?.headers.get("x-tenant")).toBe("tenant-1");
  expect(await stores.runStore.get("missing")).toBeUndefined();
  await stores.close?.();
});

test("retries transient HTTP failures and rejects permanent failures", async () => {
  let attempts = 0;
  const stores = createHttpStores({
    baseUrl: "https://storage.example",
    retryDelayMs: 0,
    fetch: async () => {
      attempts++;
      return attempts < 3 ? new Response("busy", { status: 503 }) : new Response(null, { status: 204 });
    },
  });

  await stores.sessionStore.save({ id: "session-1", history: [], runs: [] });
  expect(attempts).toBe(3);

  const failing = createHttpStores({
    baseUrl: "https://storage.example",
    retryDelayMs: 0,
    fetch: async () => new Response("forbidden", { status: 403 }),
  });
  await expect(failing.sessionStore.get("session-1")).rejects.toBeInstanceOf(HttpStorageError);
  await stores.close?.();
  await failing.close?.();
});
