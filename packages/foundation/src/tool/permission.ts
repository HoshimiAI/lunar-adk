import type { Tool } from "./types";

export function needsApproval(tool: Tool<any, any>): boolean {
  return Boolean(tool.permission?.requiresApproval);
}
