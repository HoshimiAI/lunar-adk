# lunar-adk

Agent Development Kit — Bun workspace monorepo.

## Packages

- [`packages/adk`](packages/adk) — `@lunar/adk`, the stable public facade for application developers.
- [`packages/foundation`](packages/foundation) — `@lunar/foundation`, the provider-neutral agent runtime and core contracts.
- [`packages/provider-ai-sdk`](packages/provider-ai-sdk) — `@lunar/provider-ai-sdk`, an AI SDK adapter for foundation model providers.
- [`packages/provider-openai`](packages/provider-openai) — `@lunar/provider-openai`, an OpenAI model adapter built on the AI SDK.
- [`elysia`](elysia) — Elysia HTTP adapter and runnable application example.

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
bun --cwd elysia run dev
```

Copy `elysia/.env.example` to `elysia/.env`, add `OPENAI_API_KEY`, and optionally change `OPENAI_MODEL`.

Then call the real agent:

```bash
curl -X POST http://localhost:3000/run \
  -H 'content-type: application/json' \
  -d '{"input":"Explain why Bun is useful for TypeScript APIs."}'
```

The response includes `runId` and `sessionId`. Send the `sessionId` in a later request to continue the conversation, or inspect a completed run with `GET /runs/:id`.

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
