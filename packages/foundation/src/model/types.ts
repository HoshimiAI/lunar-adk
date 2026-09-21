export interface ModelCapabilities {
  streaming?: boolean;
  tools?: boolean;
  vision?: boolean;
  structuredOutput?: boolean;
}

export interface ModelToolCall {
  id: string;
  name: string;
  input: unknown;
}

export type ModelMessage =
  | { role: "user" | "system"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ModelToolCall[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

export interface ModelResponse {
  text: string;
  toolCalls: ModelToolCall[];
  usage?: { inputTokens: number; outputTokens: number };
}

export type ModelStreamPart =
  | { type: "text-delta"; text: string }
  | { type: "response"; response: ModelResponse };

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
  stream?(options: ModelCallOptions): AsyncIterable<ModelStreamPart>;
}
