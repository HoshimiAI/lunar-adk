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
  dimensions?: number;
  id?: string;
  apiKey?: string;
  baseURL?: string;
  fetch?: typeof fetch;
}

/** Creates a small OpenAI embeddings adapter without coupling memory to a model SDK. */
export function createOpenAIEmbeddingProvider(options: OpenAIEmbeddingProviderOptions = {}): EmbeddingProvider {
  if (options.dimensions !== undefined && (!Number.isInteger(options.dimensions) || options.dimensions < 1)) {
    throw new Error("Embedding dimensions must be a positive integer.");
  }
  const request = options.fetch ?? globalThis.fetch;
  const baseURL = (options.baseURL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const model = options.model ?? "text-embedding-3-small";
  return {
    id: options.id ?? `openai:${model}`,
    model,
    ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }),
    async embedMany(inputs) {
      if (inputs.length === 0) return [];
      const response = await request(`${baseURL}/embeddings`, {
        method: "POST",
        headers: { authorization: `Bearer ${options.apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ input: inputs.length === 1 ? inputs[0] : inputs, model, ...(options.dimensions === undefined ? {} : { dimensions: options.dimensions }) }),
      });
      if (!response.ok) throw new Error(`OpenAI embeddings request failed: ${response.status} ${await response.text()}`);
      const body = await response.json() as { data?: Array<{ index?: number; embedding?: unknown }> };
      if (!Array.isArray(body.data) || body.data.length !== inputs.length) throw new Error(`OpenAI embeddings response returned ${body.data?.length ?? 0} vectors for ${inputs.length} inputs.`);
      const ordered = body.data.map((item, index) => ({ index: item.index ?? index, embedding: item.embedding }))
        .sort((left, right) => left.index - right.index);
      return ordered.map(({ embedding }) => {
        if (!Array.isArray(embedding) || !embedding.every((value) => typeof value === "number" && Number.isFinite(value))) throw new Error("OpenAI embeddings response did not contain a finite numeric vector");
        if (options.dimensions !== undefined && embedding.length !== options.dimensions) {
          throw new Error(`OpenAI embedding dimension mismatch for ${model}: expected ${options.dimensions}, received ${embedding.length}.`);
        }
        return embedding as number[];
      });
    },
    async embed(input) {
      const [embedding] = await this.embedMany!([input]);
      if (!embedding) {
        throw new Error("OpenAI embeddings response did not contain a vector.");
      }
      return embedding;
    },
  };
}
