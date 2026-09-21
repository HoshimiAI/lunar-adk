import type { Tool } from "./types";

export function needsApproval(tool: Tool): boolean {
  return Boolean(tool.permission?.requiresApproval);
}
