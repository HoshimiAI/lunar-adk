import { AgentRegistry } from "../agent";
import { ToolRegistry } from "../tool";
import { MemoryRegistry } from "../memory";
import { EvaluatorRegistry } from "../evaluation";
import { EventBus } from "../event";
import { CommandRegistry, SchemaRegistry, installPlugin, resolveOrder, type PluginContext } from "../plugin";
import type { RuntimeConfig } from "./types";

export interface Bootstrapped {
  agents: AgentRegistry;
  tools: ToolRegistry;
  memory: MemoryRegistry;
  evaluators: EvaluatorRegistry;
  events: EventBus;
}

export async function bootstrap(config: Required<RuntimeConfig>): Promise<Bootstrapped> {
  const agents = new AgentRegistry();
  const tools = new ToolRegistry();
  const memory = new MemoryRegistry();
  const evaluators = new EvaluatorRegistry();
  const events = new EventBus();

  const ctx: PluginContext = {
    agents,
    tools,
    memory,
    evaluators,
    events,
    workflows: { register: () => {} },
    commands: new CommandRegistry(),
    schemas: new SchemaRegistry(),
  };

  for (const plugin of resolveOrder(config.plugins)) {
    await installPlugin(plugin, ctx);
    events.emit("plugin.registered", { pluginId: plugin.id });
  }

  return { agents, tools, memory, evaluators, events };
}
