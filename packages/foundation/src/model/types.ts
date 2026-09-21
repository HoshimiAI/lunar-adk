export interface ModelCapabilities {
  streaming?: boolean;
  tools?: boolean;
  vision?: boolean;
  structuredOutput?: boolean;
}

export interface ModelMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

export interface ModelCallOptions {
  messages: ModelMessage[];
  system?: string;
  tools?: { name: string; description: string; inputSchema: unknown }[];
  signal?: AbortSignal;
}

export interface ModelProvider {
  id: string;
  capabilities: ModelCapabilities;
  call(options: ModelCallOptions): Promise<ModelResponse>;
}
