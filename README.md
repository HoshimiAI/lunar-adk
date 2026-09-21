# lunar-adk

Agent Development Kit — Bun workspace monorepo.

Release status: v1.0 core runtime.

## Packages

- [`packages/adk`](packages/adk) — `@lunar/adk`, the stable public facade for application developers.
- [`packages/foundation`](packages/foundation) — `@lunar/foundation`, the provider-neutral agent runtime and core contracts.
- [`packages/provider-ai-sdk`](packages/provider-ai-sdk) — `@lunar/provider-ai-sdk`, an AI SDK adapter for foundation model providers.
- [`packages/provider-openai`](packages/provider-openai) — `@lunar/provider-openai`, an OpenAI model adapter built on the AI SDK.
- [`packages/storage-sqlite`](packages/storage-sqlite) — `@lunar/storage-sqlite`, durable SQLite run and session storage.
- [`apps/elysia`](apps/elysia) — API-only Elysia HTTP adapter and runnable application.

## Install

```bash
bun install
```

## Typecheck / test

```bash
bun run typecheck
bun test
```

## Run the Elysia app

```bash
bun --cwd apps/elysia run dev
```

The service is API-only. Health checks are available at `GET /health`.

The Elysia assistant includes safe `current_time` and `calculate` tools. Try
asking “What time is it in UTC?” or “Calculate (18 + 6) / 3.”

Copy `apps/elysia/.env.example` to `apps/elysia/.env`, add `OPENAI_API_KEY`, and optionally change `OPENAI_MODEL` or `SQLITE_PATH`.

The Bruno collection in [`bruno/elysia`](bruno/elysia) covers the full API: health, runs, sessions, steering, cancellation, and approval decisions. Set its `baseUrl` environment variable to the running Elysia server; set `runId`, `sessionId`, and `approvalId` as you exercise the dependent requests.

Then call the real agent:

```bash
curl -X POST http://localhost:3000/run \
  -H 'content-type: application/json' \
  -d '{"input":"Explain why Bun is useful for TypeScript APIs."}'
```

The response includes `runId`, `sessionId`, and `status`. Send the `sessionId` in a later request to continue the conversation, inspect a run with `GET /runs/:id`, or inspect a session with `GET /sessions/:id`.

Steer a session before its next turn:

```bash
curl -X POST http://localhost:3000/sessions/<session-id>/steer \
  -H 'content-type: application/json' \
  -d '{"instruction":"Keep the next answer concise."}'
```

The v1 core intentionally leaves streaming, workflow orchestration, plugins, memory search, distributed storage, and OpenTelemetry exporters for later releases.

Approval-required tools pause a run with `status: "waiting_approval"`. Approve or reject the pending request with `POST /runs/<run-id>/approve` or `POST /runs/<run-id>/reject`, passing the returned `approvalId`. Active runs can be cancelled with `POST /runs/<run-id>/cancel`.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
