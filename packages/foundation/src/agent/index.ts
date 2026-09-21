import { EventBus } from "../event";
import { runAgentLoop } from "./loop";
import type { Agent, AgentConfig, AgentRunResult } from "./types";

export { AgentRegistry } from "./registry";
export { runSubAgent } from "./sub-agent";
export { defaultRetryPolicy, withRetry } from "./retry";
export { createCancellation } from "./cancellation";
export { canTransition } from "./state";
export type { Agent, AgentConfig, AgentRunResult, AgentState } from "./types";

export function defineAgent(config: AgentConfig, bus: EventBus = new EventBus()): Agent {
  return {
    name: config.name,
    run: (input: string): Promise<AgentRunResult> => runAgentLoop(config, input, bus),
  };
}
