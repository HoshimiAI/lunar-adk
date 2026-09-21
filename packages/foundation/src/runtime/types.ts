import type { Agent, AgentRunOptions, AgentRunResult } from "../agent";
import type { Run } from "../run";
import type { Session, SessionStore } from "../session";
import type { EventName, EventHandler } from "../event";
import type { Plugin } from "../plugin";
import type { RunStore } from "../run";

export interface RuntimeConfig {
  plugins?: Plugin[];
  runStore?: RunStore;
  sessionStore?: SessionStore;
}

export interface RuntimeHandle {
  run(agentName: string, input: string, options?: AgentRunOptions): Promise<AgentRunResult>;
  getRun(runId: string): Run | undefined;
  getStoredRun(runId: string): Promise<Run | undefined>;
  getSession(sessionId: string): Promise<Session | undefined>;
  on(event: EventName, handler: EventHandler): () => void;
  registerAgent(agent: Agent): void;
}
