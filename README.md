# lunar-adk

Agent Development Kit — Bun workspace monorepo.

Release status: v1.2 code-first workflows and managed subagents.

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

The Bruno collection in [`bruno/elysia`](bruno/elysia) covers the full API: health, runs, sessions, steering, workflow runs, cancellation, and approval decisions. Set its `baseUrl` environment variable to the running Elysia server; set `runId`, `sessionId`, `approvalId`, `workflowName`, `workflowRunId`, and `workflowApprovalId` as you exercise the dependent requests.

Then call the real agent:

```bash
curl -X POST http://localhost:3000/run \
  -H 'content-type: application/json' \
  -d '{"input":"Explain why Bun is useful for TypeScript APIs."}'
```

The response includes `runId`, `sessionId`, and `status`. Send the `sessionId` in a later request to continue the conversation, inspect a run with `GET /runs/:id`, or inspect a session with `GET /sessions/:id`.

Stream an opt-in response with Server-Sent Events:

```bash
curl -N -X POST http://localhost:3000/run/stream \
  -H 'content-type: application/json' \
  -H 'accept: text/event-stream' \
  -d '{"input":"Explain why Bun is useful for TypeScript APIs."}'
```

The stream emits named lifecycle events such as `run.started`, `tool.completed`, and `run.completed`, plus `text.delta`, `stream.completed`, and `stream.error`. The final event includes the run and session identifiers. Models without streaming support return `501` with error code `STREAMING_UNSUPPORTED`.

Register flexible code-first workflows with managed subagents:

```ts
runtime.registerWorkflow(defineWorkflow({
  name: "research",
  run: async (ctx) => {
    const analyst = await ctx.runSubAgent("analyst", "Analyze the topic");
    await ctx.checkpoint("analysis-complete", { analyst: analyst.output });
    return analyst.output;
  },
}));
```

Run a workflow through `POST /workflows/<name>/run`, inspect it with
`GET /workflow-runs/<id>`, or cancel it with `POST /workflow-runs/<id>/cancel`.
Workflows can pause with `ctx.requestApproval(id, message)` and resume through
`POST /workflow-runs/<id>/resume`. Checkpoints are persisted by the SQLite
adapter; workflow code is responsible for using `ctx.resumeFrom` to make
checkpointed sections idempotent after a restart.

Steer a session before its next turn:

```bash
curl -X POST http://localhost:3000/sessions/<session-id>/steer \
  -H 'content-type: application/json' \
  -d '{"instruction":"Keep the next answer concise."}'
```

The same endpoint can steer an active run. The runtime lets an in-flight tool
finish once, interrupts before the next model turn, and returns `202` with the
interrupted and continuation run IDs. Active streaming responses emit a
`stream.interrupted` event before closing; the continuation is a separate run.

Plugins, memory search, distributed storage, authentication, and OpenTelemetry exporters remain deferred for later releases.

Approval-required tools pause a run with `status: "waiting_approval"`. Approve or reject the pending request with `POST /runs/<run-id>/approve` or `POST /runs/<run-id>/reject`, passing the returned `approvalId`. Active runs can be cancelled with `POST /runs/<run-id>/cancel`.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
