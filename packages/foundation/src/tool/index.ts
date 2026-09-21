import type { Tool } from "./types";

export { ToolRegistry } from "./registry";
export { executeTool } from "./executor";
export { needsApproval } from "./permission";
export { schemaToJSON } from "./schema";
export type { Tool, ToolResult, ToolPermission } from "./types";

export function defineTool<Input, Output>(tool: Tool<Input, Output>): Tool<Input, Output> {
  return tool;
}
