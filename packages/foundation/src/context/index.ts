import type { ModelMessage } from "../model";
import type { BuiltContext, ContextBudget } from "./types";
import { estimateTokens } from "./budget";
import { selectRecent } from "./select";

export { estimateTokens } from "./budget";
export { selectRecent } from "./select";
export { truncate } from "./compress";
export { shapeToolResult } from "./tool-result-shape";
export type { ContextBudget, BuiltContext } from "./types";

export function buildContext(messages: ModelMessage[], budget: ContextBudget): BuiltContext {
  let selected = messages;
  let tokens = messages.reduce((sum, m) => sum + estimateTokens(m.content), 0);

  while (tokens > budget.maxTokens && selected.length > 1) {
    selected = selectRecent(selected, selected.length - 1);
    tokens = selected.reduce((sum, m) => sum + estimateTokens(m.content), 0);
  }

  return { messages: selected, estimatedTokens: tokens };
}
