# @lunar/provider-ai-sdk

Adapter between Vercel AI SDK language models and the foundation `ModelProvider` contract.

```ts
import { createAISDKModelProvider } from "@lunar/provider-ai-sdk";
```

The adapter normalizes text, tool calls, usage, and abort signals. Foundation remains responsible for tool execution and run persistence.
