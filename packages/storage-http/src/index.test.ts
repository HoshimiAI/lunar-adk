import { expect, test } from "bun:test";
import { createHttpStores, HttpStorageError } from "./index";
import { verifyStorageBundle } from "@lunar/foundation/storage/testing";

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
        const body = await request.json();
        const current = records.get(key) as { revision?: number } | undefined;
        if (request.headers.get("if-none-match") === "*" && current !== undefined) {
          return new Response("conflict", { status: 412 });
        }
        const expected = request.headers.get("if-match");
        if (expected !== null && (current?.revision ?? 0) !== Number(expected)) {
          return new Response("conflict", { status: 412 });
        }
        records.set(key, body);
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
  expect(requests[0]?.headers.get("if-none-match")).toBe("*");
  expect(await stores.runStore.get("missing")).toBeUndefined();
  await verifyStorageBundle(stores);
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

test("lists recoverable workflows through the HTTP storage contract", async () => {
  const records = new Map<string, unknown>();
  const stores = createHttpStores({
    baseUrl: "https://storage.example",
    fetch: async (input, init) => {
      const url = new URL(input as string);
      if (url.pathname === "/v1/workflow-runs" && url.searchParams.get("status") === "running") {
        return Response.json([...records.values()].filter((value) => (value as { status?: string }).status === "running"));
      }
      if (init?.method === "PUT") {
        records.set(url.pathname, await new Request(input as string, init).json());
        return new Response(null, { status: 204 });
      }
      return Response.json(records.get(url.pathname));
    },
  });
  const base = {
    workflow: "recoverable",
    version: "1",
    input: {},
    state: {},
    checkpoints: [],
    childRunIds: [],
    startedAt: 1,
    approvedApprovalIds: [],
  };
  await stores.workflowStore.save({ ...base, id: "running", status: "running" });
  await stores.workflowStore.save({ ...base, id: "waiting", status: "waiting_approval" });

  expect((await stores.workflowStore.listRecoverable?.())?.map((run) => run.id)).toEqual(["running"]);
  await stores.close();
});
