import { createOpenAI } from "@ai-sdk/openai";
import { createAISDKModelProvider } from "@lunar/provider-ai-sdk";
import type { ModelProvider } from "@lunar/foundation/model";
import type { EmbeddingProvider } from "@lunar/foundation/memory";

export interface OpenAIModelProviderOptions {
  model: string;
  id?: string;
  apiKey?: string;
  baseURL?: string;
  organization?: string;
  project?: string;
  headers?: Record<string, string>;
  name?: string;
  fetch?: typeof fetch;
  capabilities?: ModelProvider["capabilities"];
}

export function createOpenAIModelProvider(options: OpenAIModelProviderOptions): ModelProvider {
  const provider = createOpenAI({
    apiKey: options.apiKey,
    baseURL: options.baseURL,
    organization: options.organization,
    project: options.project,
    headers: options.headers,
    name: options.name,
    fetch: options.fetch,
  });

  return createAISDKModelProvider({
    id: options.id ?? `openai:${options.model}`,
    model: provider(options.model),
    capabilities: options.capabilities,
  });
}

export interface OpenAIEmbeddingProviderOptions {
  model?: string;
  id?: string;
  apiKey?: string;
  baseURL?: string;
  fetch?: typeof fetch;
}

/** Creates a small OpenAI embeddings adapter without coupling memory to a model SDK. */
export function createOpenAIEmbeddingProvider(options: OpenAIEmbeddingProviderOptions = {}): EmbeddingProvider {
  const request = options.fetch ?? globalThis.fetch;
  const baseURL = (options.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  return {
    id: options.id ?? `openai:${options.model ?? "text-embedding-3-small"}`,
    async embed(input) {
      const response = await request(`${baseURL}/embeddings`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ input, model: options.model ?? "text-embedding-3-small" }),
      });
      if (!response.ok) throw new Error(`OpenAI embeddings request failed: ${response.status} ${await response.text()}`);
      const body = await response.json() as { data?: Array<{ embedding?: unknown }> };
      const embedding = body.data?.[0]?.embedding;
      if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number")) throw new Error("OpenAI embeddings response did not contain a numeric vector");
      return embedding;
    },
  };
}
