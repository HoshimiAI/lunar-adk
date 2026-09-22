import { EventBus } from "../event";
import { runAgentLoop } from "./loop";
import type { Agent, AgentConfig, AgentRunOptions, AgentRunResult } from "./types";

export { AgentRegistry } from "./registry";
export { runSubAgent } from "./sub-agent";
export { defaultRetryPolicy, withRetry } from "./retry";
export { AgentRunError } from "./errors";
export { createCancellation, throwIfAborted } from "./cancellation";
export { canTransition } from "./state";
export type { Agent, AgentConfig, AgentMemoryConfig, AgentRunOptions, AgentRunResult, AgentState } from "./types";
export type { AgentErrorCode } from "./errors";

export function defineAgent(config: AgentConfig, bus: EventBus = new EventBus()): Agent {
  const memory = config.memory === true ? {} : config.memory || undefined;
  return {
    name: config.name,
    modelId: config.model.id,
    supportsStreaming: config.model.capabilities.streaming === true && typeof config.model.stream === "function",
    memory,
    run: (input: string, options?: AgentRunOptions): Promise<AgentRunResult> =>
      runAgentLoop(config, input, bus, options),
  };
}
