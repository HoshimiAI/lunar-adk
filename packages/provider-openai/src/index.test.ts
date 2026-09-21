import { expect, test } from "bun:test";
import { createOpenAIModelProvider } from "./index";

test("creates a foundation provider for an OpenAI model", () => {
  const provider = createOpenAIModelProvider({
    model: "gpt-5",
    apiKey: "test-key",
  });

  expect(provider.id).toBe("openai:gpt-5");
  expect(provider.capabilities).toEqual({
    streaming: true,
    tools: true,
    structuredOutput: true,
  });
});

test("supports custom OpenAI-compatible configuration", () => {
  const provider = createOpenAIModelProvider({
    model: "local-model",
    id: "local-openai",
    baseURL: "http://localhost:1234/v1",
    apiKey: "local-key",
    capabilities: { tools: false },
  });

  expect(provider.id).toBe("local-openai");
  expect(provider.capabilities).toEqual({ tools: false });
});
