import type { ModelMessage } from "../model";

export function selectRecent(messages: ModelMessage[], limit: number): ModelMessage[] {
  return messages.slice(-limit);
}
