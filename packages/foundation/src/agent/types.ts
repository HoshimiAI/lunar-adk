import type { ModelProvider } from "../model";
import type { Tool } from "../tool";
import type { Run } from "../run";

export type AgentState = "idle" | "running" | "waiting" | "done" | "error";

export interface AgentConfig {
  name: string;
  model: ModelProvider;
  systemPrompt?: string;
  tools?: Tool<any, any>[];
  maxToolRoundtrips?: number;
}

export interface AgentRunResult {
  output: string;
  run: Run<string>;
}

export interface Agent {
  name: string;
  run(input: string): Promise<AgentRunResult>;
}
