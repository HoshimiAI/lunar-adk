# lunar-adk

Agent Development Kit — Bun workspace monorepo.

## Packages

- [`packages/core`](packages/core) — `@lunar-adk/core`, the agent framework (Agent, defineTool, Session).
- [`packages/examples`](packages/examples) — runnable sample agents.

## Install

```bash
bun install
```

## Typecheck / test

```bash
bun run typecheck
bun test
```

## Run example

Needs `ANTHROPIC_API_KEY` set (Bun auto-loads `.env`).

```bash
bun run example:weather
```

This project was created using `bun init` in bun v1.3.14. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
