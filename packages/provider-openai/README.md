# @lunar/provider-openai

OpenAI provider for Lunar ADK, implemented through the AI SDK.

```ts
import { createOpenAIModelProvider } from "@lunar/provider-openai";

const model = createOpenAIModelProvider({
  model: "gpt-5-mini",
  apiKey: process.env.OPENAI_API_KEY,
});
```

Set `OPENAI_API_KEY` through the environment. Use `test:live` only for explicit real-API checks.
