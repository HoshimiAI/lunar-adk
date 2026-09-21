import type { ModelMessage } from "../model";

export interface ContextBudget {
  maxTokens: number;
}

export interface BuiltContext {
  messages: ModelMessage[];
  estimatedTokens: number;
}
