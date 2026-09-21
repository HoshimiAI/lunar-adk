# Changelog

## Unreleased

- Fixed plugin workflow registration by sharing the runtime workflow registry.
- Added revision-aware storage saves and stale-write conflict detection.
- Normalized sessions to store run references instead of full run records.
- Added runtime-owned storage bundle shutdown and atomic SQLite run/session saves.

- Added a generic HTTP storage provider for runs, sessions, and workflows.
- Added Bun.SQL storage for SQLite, PostgreSQL, MySQL, and MariaDB.
- Added an SDK-neutral MongoDB storage adapter.
- Added local/remote storage selection to the Elysia example.
- Documented the storage contract for future Unknown Planet compatibility.

- Added optional observability exporters for console output and OTLP traces.
- Added agent, model, and tool trace spans with token and status metadata.
- Added default telemetry redaction and Elysia environment configuration.

## 1.2.0

- Added flexible code-first workflow definitions with explicit checkpoints and approval pauses.
- Added durable workflow run storage and workflow lifecycle HTTP endpoints.
- Added managed subagent execution with parent-child run linkage and shared cancellation.
- Added mid-conversation steering with linked continuation runs and stream interruption handoff events.

## 1.1.0

- Added opt-in model streaming through the provider and runtime contracts.
- Added `POST /run/stream` with named SSE lifecycle and text-delta events.
- Added streaming capability detection with a stable `501` response.
- Added deterministic runtime and Elysia streaming tests.
- Added a Bruno streaming request example.

## 1.0.0

- Added the stable `@lunar/adk` public facade.
- Added provider-neutral agent, tool, model, run, and session runtime contracts.
- Added OpenAI integration through the AI SDK.
- Added durable SQLite run and session storage.
- Added Elysia HTTP routes for execution and run inspection.
- Added between-turn session steering through the runtime and Elysia API.
- Added structured tool-call messages and provider capability enforcement.
- Added runtime-wide lifecycle events, cancellation, and persisted approval/resume controls.
- Added session inspection and run cancellation/approval HTTP endpoints.
- Added deterministic, contract, integration, and opt-in live tests.

Deferred from v1: streaming, workflows, plugins, memory search, distributed storage, and OpenTelemetry exporters.
