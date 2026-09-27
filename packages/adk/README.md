# @lunar-adk/adk

Stable application-facing API for Lunar ADK.

```ts
import { createRuntime, defineAgent } from "@lunar-adk/adk";
```

Use `@lunar-adk/foundation` only when building advanced adapters or extending the runtime.

Plugin and evaluation APIs are available separately from
`@lunar-adk/adk/experimental` and are not covered by the stable v1 contract.
Memory and workflow APIs are part of the stable `@lunar-adk/adk` facade.
