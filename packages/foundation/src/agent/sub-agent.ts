import type { Agent, AgentRunOptions, AgentRunResult } from "./types";

export async function runSubAgent(
  agent: Agent,
  input: string,
  options?: AgentRunOptions,
): Promise<AgentRunResult> {
  return agent.run(input, options);
}
