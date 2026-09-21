import type { ModelMessage } from "../model";

export function truncate(message: ModelMessage, maxChars: number): ModelMessage {
  if (message.content.length <= maxChars) return message;
  return { ...message, content: `${message.content.slice(0, maxChars)}…` };
}
