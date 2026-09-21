# @lunar/foundation

Domain-agnostic agent runtime. Provides capabilities (agent, tool, model,
memory, context, workflow, run, event, plugin, session, evaluation);
domain intelligence (Science, Coding, Project, ...) lives in separate
plugin packages that depend on this one — never the reverse.

## Structure

- `src/agent` — agent definition, execution loop, state, retry, cancellation, sub-agents
- `src/tool` — tool definition, schema, registry, execution, permissions
- `src/model` — model provider abstraction + registry
- `src/memory` — generic memory interface + registry (no concrete stores beyond an in-memory dev default)
- `src/context` — prompt construction, token budgeting, selection, compression
- `src/workflow` — sequential/parallel/conditional/approval orchestration
- `src/run` — the execution record: lifecycle, trace, artifacts, usage, inspect/replay/fork/compare
- `src/event` — typed event bus
- `src/plugin` — plugin manifest, registry, lifecycle, dependency resolution, `PluginContext`
- `src/session` — multi-turn conversation container
- `src/evaluation` — evaluator registry + scoring
- `src/runtime` — `createRuntime` composition root (the only module allowed to import everything)
- `src/types` — cross-cutting primitives only (`Result`, JSON schema helpers, `Brand`)

## Public API

```ts
import { createRuntime, defineAgent, defineTool, definePlugin, defineWorkflow, createMemory } from "@lunar/foundation";
```

Subpath exports (`@lunar/foundation/agent`, `/tool`, `/plugin`, ...) expose only stable per-feature APIs — see `package.json` `exports`.

## Examples

- `examples/basic-agent` — minimal agent with a stub model provider
- `examples/custom-plugin` — fake "notes" plugin proving the plugin contract (no domain logic)
