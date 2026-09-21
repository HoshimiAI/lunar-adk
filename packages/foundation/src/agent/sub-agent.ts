import type { Agent, AgentRunResult } from "./types";

export async function runSubAgent(agent: Agent, input: string): Promise<AgentRunResult> {
  return agent.run(input);
}
