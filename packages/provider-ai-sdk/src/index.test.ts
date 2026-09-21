import { expect, test } from "bun:test";
import type { LanguageModel } from "ai";
import { createAISDKModelProvider } from "./index";

test("creates a foundation provider without leaking AI SDK configuration", () => {
  const provider = createAISDKModelProvider({
    id: "test-model",
    model: "test-provider:test-model" as LanguageModel,
  });

  expect(provider.id).toBe("test-model");
  expect(provider.capabilities).toEqual({
    streaming: true,
    tools: true,
    structuredOutput: true,
  });
  expect(provider.stream).toBeFunction();
});

test("allows adapter capabilities to be overridden", () => {
  const provider = createAISDKModelProvider({
    id: "text-only",
    model: "test-provider:text-only" as LanguageModel,
    capabilities: { tools: false, structuredOutput: false },
  });

  expect(provider.capabilities).toEqual({ tools: false, structuredOutput: false });
});
