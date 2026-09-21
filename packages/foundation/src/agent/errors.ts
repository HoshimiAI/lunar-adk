import type { Run } from "../run";

export class AgentRunError extends Error {
  constructor(message: string, public readonly run: Run<string>, options?: ErrorOptions) {
    super(message, options);
    this.name = "AgentRunError";
  }
}
