# Lunar storage through Unknown Planet

`@lunar/storage-unknown-planet` implements Lunar's `StorageBundle` with a scoped Unknown Planet `Planet` client. Its SQL capability must use PostgreSQL transactions.

```ts
import { createUnknownPlanetMemoryProvider, createUnknownPlanetStorage, migrateUnknownPlanetStorage } from "@lunar/storage-unknown-planet";

await migrateUnknownPlanetStorage({ planet });
const storage = createUnknownPlanetStorage({ planet, scope: { tenantId: "acme" } });
const memory = createUnknownPlanetMemoryProvider({ planet, scope: { tenantId: "acme" } });
const runtime = await createRuntime({ storage, memory });
```

The migration creates `lunar.runs`, `lunar.sessions`, and `lunar.workflow_runs`. It is additive and safe to rerun. Apply it before serving traffic. Keep the schema when rolling back application code so existing runs and sessions remain available; removing it is a separate data deletion decision.

The caller owns the `Planet` instance and its database connection. Construct a storage bundle for each authenticated tenant or workspace. The adapter enforces that scope on every SQL operation. A database integration check runs when `UP_TEST_DATABASE_URL` points to a dedicated PostgreSQL database.

From the repository root, start the dedicated local test database and run the integration check:

```sh
docker compose up -d --wait unknown-planet-test-db
UP_TEST_DATABASE_URL=postgres://lunar_test:lunar_test@localhost:55432/lunar_test bun test packages/storage-unknown-planet/src/index.integration.test.ts
```

The Compose service binds only to localhost and stores data in the `unknown-planet-test-data` volume. Stop it with `docker compose down`; remove the test data too with `docker compose down -v`.

The memory provider maps Lunar records to Unknown Planet's scoped memory store and vectors. It preserves Lunar owner, namespace, metadata, and expiry fields, filters expired records during retrieval and listing, and uses cursor-based Planet memory search for listing. Supply an `embedding` when storing records to enable vector retrieval. Configure Planet's memory, vector, and graph capabilities for the operations you use; Planet memory deletion cleans up related graph and vector data. The caller still owns the Planet client and should close its providers after the runtime has stopped.

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
