import type { Agent } from "./types";

export class AgentRegistry {
  private agents = new Map<string, Agent>();

  register(agent: Agent): void {
    this.agents.set(agent.name, agent);
  }

  get(name: string): Agent | undefined {
    return this.agents.get(name);
  }

  list(): Agent[] {
    return [...this.agents.values()];
  }
}
