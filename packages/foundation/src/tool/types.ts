import type { SchemaLike } from "../types";

export interface ToolPermission {
  requiresApproval?: boolean;
}

export interface Tool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  schema: SchemaLike<Input>;
  permission?: ToolPermission;
  execute: (input: Input) => Promise<Output> | Output;
}

export interface ToolResult<Output = unknown> {
  toolName: string;
  output?: Output;
  error?: string;
}
