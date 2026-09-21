# Changelog

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
