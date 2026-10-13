import type { SchemaLike } from "../types";
import type { AuthPrincipal } from "../auth";

/** Short-lived access material resolved by a host-owned credential vault. Never persist this value in run/session state. */
export interface ToolCredential {
  accessToken: string;
  tokenType?: string;
  expiresAt?: number;
  scopes?: readonly string[];
}

/** Host adapter that resolves credentials for an already authenticated principal. */
export interface ToolCredentialProvider {
  resolve(input: {
    principal: AuthPrincipal;
    toolName: string;
    credentialId: string;
    scopes?: readonly string[];
  }): Promise<ToolCredential | undefined>;
}

export interface ToolPermission {
  requiresApproval?: boolean;
}

export interface ToolExecutionContext {
  /** Aborted when the parent agent run is cancelled or steered. */
  signal?: AbortSignal;
  /** Request a short-lived credential by a server-configured reference. The host must authorize this principal/tool/reference combination. */
  getCredential?: (request: { credentialId: string; scopes?: readonly string[] }) => Promise<ToolCredential | undefined>;
}

export interface Tool<Input = unknown, Output = unknown> {
  name: string;
  description: string;
  schema: SchemaLike<Input>;
  permission?: ToolPermission;
  execute: (input: Input, context?: ToolExecutionContext) => Promise<Output> | Output;
}

export interface ToolResult<Output = unknown> {
  toolName: string;
  output?: Output;
  error?: string;
}
