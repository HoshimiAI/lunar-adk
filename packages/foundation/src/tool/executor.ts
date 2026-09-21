import type { Tool, ToolResult } from "./types";

export async function executeTool<Input, Output>(
  tool: Tool<Input, Output>,
  rawInput: unknown,
): Promise<ToolResult<Output>> {
  try {
    const input = tool.schema.parse(rawInput);
    const output = await tool.execute(input);
    return { toolName: tool.name, output };
  } catch (error) {
    return { toolName: tool.name, error: error instanceof Error ? error.message : String(error) };
  }
}
