import { generateText, jsonSchema, type LanguageModel, type ToolSet } from "ai";
import type {
  ModelCallOptions,
  ModelProvider,
  ModelResponse,
  ModelToolCall,
} from "@lunar/foundation/model";

export interface AISDKModelProviderOptions {
  id: string;
  model: LanguageModel;
  capabilities?: ModelProvider["capabilities"];
}

function toTools(options: ModelCallOptions): ToolSet | undefined {
  if (!options.tools?.length) return undefined;

  return Object.fromEntries(
    options.tools.map((tool) => [
      tool.name,
      {
        description: tool.description,
        inputSchema: jsonSchema(tool.inputSchema as Record<string, unknown>),
      },
    ]),
  );
}

function normalizeToolCalls(toolCalls: Array<{ toolCallId: string; toolName: string; input: unknown }>): ModelToolCall[] {
  return toolCalls.map((toolCall) => ({
    id: toolCall.toolCallId,
    name: toolCall.toolName,
    input: toolCall.input,
  }));
}

function toAISDKMessages(messages: ModelCallOptions["messages"]): unknown[] {
  return messages.map((message) => {
    if (message.role === "tool") {
      return {
        role: "tool",
        content: [{
          type: "tool-result",
          toolCallId: message.toolCallId,
          output: { type: "text", value: message.content },
        }],
      };
    }
    if (message.role === "assistant" && message.toolCalls?.length) {
      return {
        role: "assistant",
        content: [
          ...(message.content ? [{ type: "text", text: message.content }] : []),
          ...message.toolCalls.map((toolCall) => ({
            type: "tool-call",
            toolCallId: toolCall.id,
            toolName: toolCall.name,
            input: toolCall.input,
          })),
        ],
      };
    }
    return message;
  });
}

export function createAISDKModelProvider(options: AISDKModelProviderOptions): ModelProvider {
  return {
    id: options.id,
    capabilities: options.capabilities ?? { streaming: true, tools: true, structuredOutput: true },
    async call(callOptions): Promise<ModelResponse> {
      const result = await generateText({
        model: options.model,
        system: callOptions.system,
        messages: toAISDKMessages(callOptions.messages) as never,
        tools: toTools(callOptions),
        abortSignal: callOptions.signal,
      });

      return {
        text: result.text,
        toolCalls: normalizeToolCalls(result.toolCalls),
        usage: {
          inputTokens: result.usage.inputTokens ?? 0,
          outputTokens: result.usage.outputTokens ?? 0,
        },
      };
    },
  };
}

export type { LanguageModel } from "ai";
