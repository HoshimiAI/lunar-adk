import { resolveConfig } from "./config";
import { bootstrap } from "./bootstrap";
import type { Run } from "../run";
import type { RuntimeConfig, RuntimeHandle } from "./types";

export type { RuntimeConfig, RuntimeHandle } from "./types";

export async function createRuntime(config: RuntimeConfig = {}): Promise<RuntimeHandle> {
  const resolved = resolveConfig(config);
  const { agents, events } = await bootstrap(resolved);
  const runs = new Map<string, Run>();

  return {
    async run(agentName, input) {
      const agent = agents.get(agentName);
      if (!agent) throw new Error(`Unknown agent: ${agentName}`);
      const result = await agent.run(input);
      runs.set(result.run.id, result.run);
      return result;
    },
    getRun: (runId) => runs.get(runId),
    on: (event, handler) => events.on(event, handler),
    registerAgent: (agent) => agents.register(agent),
  };
}
