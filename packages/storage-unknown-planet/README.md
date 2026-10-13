# Lunar storage through Unknown Planet

`@lunar-adk/storage-unknown-planet` implements Lunar's `StorageBundle` with a scoped Unknown Planet `Planet` client. Its SQL capability must use PostgreSQL transactions.

## Compose adapters with one client and scope

Select only the capabilities your runtime uses. The factory shares the same explicit client and tenant/workspace scope across the selected adapters; the application still owns Planet configuration, connection lifecycle, and storage migration.

```ts
import { createRuntime } from "@lunar-adk/adk";
import { createUnknownPlanetAdapters, migrateUnknownPlanetStorage } from "@lunar-adk/storage-unknown-planet";

const scope = { tenantId: "acme", workspaceId: "research" };
await migrateUnknownPlanetStorage({ planet }); // only when selecting SQL storage

const adapters = createUnknownPlanetAdapters({
  planet,
  scope,
  storage: true,
  memory: { writeMode: "persist" },
  context: true,
});
const runtime = await createRuntime(adapters);
```

Use `storage: true`, `memory: { ... }`, and `context: true` independently; leave out adapters that the runtime does not need. Context retrieval does not require the storage migration. Stop the runtime before closing the caller-owned Planet providers.

## Source-aware knowledge context

Use the context adapter to retrieve attributed knowledge through an already configured, scoped Planet client. Lunar owns agent execution and prompt context; Planet owns provider routing, ingestion, retrieval, and source attribution. This adapter does not construct database clients, add database drivers, or run migrations for retrieval.

```ts
import { createRuntime, defineAgent } from "@lunar-adk/adk";
import { createUnknownPlanetContextProvider } from "@lunar-adk/storage-unknown-planet";

const scope = { tenantId: "acme", workspaceId: "research" };
const context = createUnknownPlanetContextProvider({ planet, scope });
const runtime = await createRuntime({ context });
runtime.registerAgent(defineAgent({
  name: "researcher",
  model,
  context: { providerId: context.id, retrieveLimit: 6 },
}));

const result = await runtime.run("researcher", "What supports this claim?", {
  tenantId: scope.tenantId,
  workspaceId: scope.workspaceId,
});
const attribution = result.run.events.find((event) => event.name === "context.retrieved")?.payload;
```

Retrieved content is passed as untrusted context. Stable source labels and their references are retained in the `context.retrieved` run event for citations. Configure Planet's query capabilities on the caller-owned client; no database migration is needed for context retrieval.

```ts
import { createUnknownPlanetMemoryProvider, createUnknownPlanetStorage, migrateUnknownPlanetStorage } from "@lunar-adk/storage-unknown-planet";

await migrateUnknownPlanetStorage({ planet });
const storage = createUnknownPlanetStorage({ planet, scope: { tenantId: "acme" } });
const memory = createUnknownPlanetMemoryProvider({ planet, scope: { tenantId: "acme" } });
const runtime = await createRuntime({ storage, memory });
```

The migration creates `lunar.runs`, `lunar.sessions`, and `lunar.workflow_runs`. It is additive and safe to rerun. Apply it before serving traffic. Keep the schema when rolling back application code so existing runs and sessions remain available; removing it is a separate data deletion decision.

The caller owns the `Planet` instance and its database connection. Configure a tenant scope on the adapters; tenant-only scopes can select the authenticated workspace per operation. When a workspace is configured, the adapters enforce that workspace on every operation. The Elysia app carries the principal's tenant, workspace, and user ID through run, session, workflow, and memory operations. Session history and saved runs belong to the creating user; workspace scope keeps their records in the right database partition. Unknown Planet remains the only component here that owns database orchestration. A database integration check runs when `UP_TEST_DATABASE_URL` points to a dedicated PostgreSQL database.

From the repository root, start the dedicated local test database and run the integration check:

```sh
docker compose up -d --wait unknown-planet-test-db
UP_TEST_DATABASE_URL=postgres://lunar_test:lunar_test@localhost:55432/lunar_test bun test packages/storage-unknown-planet/src/index.integration.test.ts
```

The Compose service binds only to localhost and stores data in the `unknown-planet-test-data` volume. Stop it with `docker compose down`; remove the test data too with `docker compose down -v`.

The memory provider maps Lunar records to Unknown Planet's scoped memory store. It preserves Lunar owner, namespace, metadata, and expiry fields, filters expired records during retrieval and listing, and uses cursor-based Planet memory search for listing. By default, it uses SDK 1.1's `planet.memory.add()` for semantic ingestion; configure Planet's memory, vector, graph, and embedding capabilities. Set `writeMode: "persist"` to use `planet.memory.persist()` when another system owns embeddings and graph ingestion. Persist mode needs only Planet's memory store and provides lexical search. Both modes use Planet memory deletion, which cleans up related graph and vector data when present. The caller still owns the Planet client and should close its providers after the runtime has stopped.

```ts
const memory = createUnknownPlanetMemoryProvider({
  planet,
  scope: { tenantId: "acme" },
  writeMode: "persist",
});
```

The Elysia app can opt into its SQL storage with `STORAGE_PROVIDER=unknown-planet` and `DATABASE_URL`. It runs this package's migration at startup and scopes records to `PLANET_TENANT_ID` (default `lunar-local`).

For authenticated live HTTP checks, use the opt-in local test server. It requires a temporary bearer token and registers a `research` workflow that waits for approval:

```sh
STORAGE_PROVIDER=unknown-planet \
DATABASE_URL=postgres://lunar_test:lunar_test@localhost:55432/lunar_test \
MEMORY_PROVIDER=postgres \
PLANET_TENANT_ID=lunar-curl \
LIVE_TEST_BEARER_TOKEN=lunar-local-test-only \
PORT=3000 bun run --cwd apps/elysia live:unknown-planet
```

Send `Authorization: Bearer lunar-local-test-only` with protected requests. This local harness uses Unknown Planet for runs, sessions, and workflow records, and the PostgreSQL memory adapter for the HTTP memory routes.

To run the app locally with the Compose database, start it from the repository root:

```sh
STORAGE_PROVIDER=unknown-planet DATABASE_URL=postgres://lunar_test:lunar_test@localhost:55432/lunar_test bun run --cwd apps/elysia start
```

Then check readiness and make a real model request with `curl`:

```sh
curl http://localhost:3000/readyz
curl -X POST http://localhost:3000/run \
  -H 'content-type: application/json' \
  -d '{"input":"Reply with the exact phrase unknown-planet-live-ok and nothing else."}'
```

The run response includes `runId` and `sessionId`; use them with `GET /runs/:id` and `GET /sessions/:id` to verify persisted records. Pass the `sessionId` in another `/run` request to check session continuation.
