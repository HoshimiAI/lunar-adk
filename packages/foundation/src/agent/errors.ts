import type { Run } from "../run";

export type AgentErrorCode =
  | "CANCELLED"
  | "STEERED"
  | "MAX_TOOL_ROUNDS"
  | "EXECUTION_FAILED"
  | "APPROVAL_REQUIRED"
  | "APPROVAL_REJECTED"
  | "POLICY_DENIED";

export class AgentRunError extends Error {
  constructor(
    message: string,
    public readonly run: Run<string>,
    public readonly code: AgentErrorCode = "EXECUTION_FAILED",
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AgentRunError";
  }
}
