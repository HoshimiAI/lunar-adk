import type { AuthPrincipal } from "../auth";
import type { Tool, ToolCredentialProvider, ToolResult } from "./types";
import { needsApproval } from "./permission";

export async function executeTool<Input, Output>(
  tool: Tool<Input, Output>,
  rawInput: unknown,
  options: { approved?: boolean; signal?: AbortSignal; principal?: AuthPrincipal; credentialProvider?: ToolCredentialProvider } = {},
): Promise<ToolResult<Output>> {
  try {
    if (needsApproval(tool) && !options.approved) {
      return {
        toolName: tool.name,
        error: `APPROVAL_REQUIRED: Tool "${tool.name}" requires approval before execution`,
      };
    }
    const input = tool.schema.parse(rawInput);
    const output = await tool.execute(input, {
      signal: options.signal,
      ...(options.principal && options.credentialProvider ? {
        getCredential: async (request) => {
          try {
            const credential = await options.credentialProvider!.resolve({
              principal: options.principal!,
              toolName: tool.name,
              ...request,
            });
            if (credential && (typeof credential.accessToken !== "string" || credential.accessToken.length === 0)) {
              throw new Error("Invalid credential");
            }
            return credential;
          } catch {
            throw new Error("Credential resolution failed");
          }
        },
      } : {}),
    });
    return { toolName: tool.name, output };
  } catch (error) {
    return { toolName: tool.name, error: error instanceof Error ? error.message : String(error) };
  }
}
