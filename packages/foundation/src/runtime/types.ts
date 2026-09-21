import type { Agent, AgentRunResult } from "../agent";
import type { Run } from "../run";
import type { EventName, EventHandler } from "../event";
import type { Plugin } from "../plugin";

export interface RuntimeConfig {
  plugins?: Plugin[];
}

export interface RuntimeHandle {
  run(agentName: string, input: string): Promise<AgentRunResult>;
  getRun(runId: string): Run | undefined;
  on(event: EventName, handler: EventHandler): () => void;
  registerAgent(agent: Agent): void;
}
