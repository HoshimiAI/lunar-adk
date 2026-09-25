import type { Tool, ToolResult } from "./types";
import { needsApproval } from "./permission";

export async function executeTool<Input, Output>(
  tool: Tool<Input, Output>,
  rawInput: unknown,
  options: { approved?: boolean; signal?: AbortSignal } = {},
): Promise<ToolResult<Output>> {
  try {
    if (needsApproval(tool) && !options.approved) {
      return {
        toolName: tool.name,
        error: `APPROVAL_REQUIRED: Tool "${tool.name}" requires approval before execution`,
      };
    }
    const input = tool.schema.parse(rawInput);
    const output = await tool.execute(input, { signal: options.signal });
    return { toolName: tool.name, output };
  } catch (error) {
    return { toolName: tool.name, error: error instanceof Error ? error.message : String(error) };
  }
}
