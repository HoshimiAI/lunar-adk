import { expect, test } from "bun:test";
import { createOpenAIEmbeddingProvider, createOpenAIModelProvider } from "./index";

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

test("exposes and validates embedding model dimensions", async () => {
  let request: Record<string, unknown> | undefined;
  const embedding = createOpenAIEmbeddingProvider({
    model: "test-embedding",
    dimensions: 3,
    apiKey: "test-key",
    fetch: async (_input, init) => {
      request = JSON.parse(String(init?.body));
      return Response.json({ data: [{ embedding: [0.1, 0.2, 0.3] }] });
    },
  });

  await expect(embedding.embed("hello")).resolves.toEqual([0.1, 0.2, 0.3]);
  expect(embedding.model).toBe("test-embedding");
  expect(embedding.dimensions).toBe(3);
  expect(request).toMatchObject({ model: "test-embedding", dimensions: 3, input: "hello" });
});

test("rejects embedding responses that do not match configured dimensions", async () => {
  const embedding = createOpenAIEmbeddingProvider({
    model: "test-embedding",
    dimensions: 3,
    apiKey: "test-key",
    fetch: async () => Response.json({ data: [{ embedding: [0.1, 0.2] }] }),
  });

  await expect(embedding.embed("hello")).rejects.toThrow("expected 3, received 2");
});

test("embeds chunks in one request and restores input order", async () => {
  let calls = 0;
  let request: Record<string, unknown> | undefined;
  const embedding = createOpenAIEmbeddingProvider({
    model: "test-embedding",
    dimensions: 2,
    apiKey: "test-key",
    fetch: async (_input, init) => {
      calls += 1;
      request = JSON.parse(String(init?.body));
      return Response.json({ data: [
        { index: 1, embedding: [0, 1] },
        { index: 0, embedding: [1, 0] },
      ] });
    },
  });

  await expect(embedding.embedMany?.(["first", "second"])).resolves.toEqual([[1, 0], [0, 1]]);
  expect(calls).toBe(1);
  expect(request).toMatchObject({ input: ["first", "second"], dimensions: 2 });
});
