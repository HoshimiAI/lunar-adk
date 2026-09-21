import { AgentRegistry } from "../agent";
import { ToolRegistry } from "../tool";
import { MemoryRegistry, createInMemoryProvider } from "../memory";
import { EvaluatorRegistry } from "../evaluation";
import { EventBus } from "../event";
import { CommandRegistry, SchemaRegistry, installPlugin, resolveOrder, type PluginContext } from "../plugin";
import type { RuntimeConfig } from "./types";
import type { Workflow } from "../workflow";

export interface Bootstrapped {
  agents: AgentRegistry;
  tools: ToolRegistry;
  memory: MemoryRegistry;
  evaluators: EvaluatorRegistry;
  events: EventBus;
  workflows: Map<string, Workflow>;
}

export async function bootstrap(
  config: Required<Pick<RuntimeConfig, "plugins">>,
  memoryProvider?: RuntimeConfig["memory"],
): Promise<Bootstrapped> {
  const agents = new AgentRegistry();
  const tools = new ToolRegistry();
  const memory = new MemoryRegistry();
  memory.register(memoryProvider ?? createInMemoryProvider());
  const evaluators = new EvaluatorRegistry();
  const events = new EventBus();
  const workflows = new Map<string, Workflow>();

  const ctx: PluginContext = {
    agents,
    tools,
    memory,
    evaluators,
    events,
    workflows: {
      register(workflowOrId: Workflow | string, run?: () => Promise<unknown>) {
        const workflow = typeof workflowOrId === "string"
          ? { name: workflowOrId, version: "1", run: run! }
          : workflowOrId;
        workflows.set(workflow.name, workflow);
      },
    },
    commands: new CommandRegistry(),
    schemas: new SchemaRegistry(),
  };

  for (const plugin of resolveOrder(config.plugins)) {
    await installPlugin(plugin, ctx);
    events.emit("plugin.registered", { pluginId: plugin.id });
  }

  return { agents, tools, memory, evaluators, events, workflows };
}
