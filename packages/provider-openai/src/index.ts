import { createOpenAI } from "@ai-sdk/openai";
import { createAISDKModelProvider } from "@lunar/provider-ai-sdk";
import type { ModelProvider } from "@lunar/foundation/model";

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
