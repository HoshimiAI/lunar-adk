import type { ToolResult } from "../tool";

export function shapeToolResult(result: ToolResult): string {
  if (result.error) return `Error: ${result.error}`;
  return typeof result.output === "string" ? result.output : JSON.stringify(result.output);
}
