import { AgentRegistry } from "../agent";
import { ToolRegistry } from "../tool";
import { MemoryRegistry, createInMemoryProvider } from "../memory";
import { EvaluatorRegistry } from "../evaluation";
import { EventBus } from "../event";
import { CommandRegistry, SchemaRegistry, installPlugin, resolveOrder, stopPlugin, type Plugin, type PluginContext } from "../plugin";
import type { RuntimeConfig } from "./types";
import type { Workflow } from "../workflow";
import { validatePolicyRule, type PolicyRule } from "../policy";

export interface Bootstrapped {
  agents: AgentRegistry;
  tools: ToolRegistry;
  memory: MemoryRegistry;
  evaluators: EvaluatorRegistry;
  events: EventBus;
  workflows: Map<string, Workflow>;
  policyRules: readonly PolicyRule[];
  plugins: Plugin[];
  shutdownPlugins(): Promise<void>;
}

export async function bootstrap(
  config: Required<Pick<RuntimeConfig, "plugins" | "policyRules">>,
  memoryProvider?: RuntimeConfig["memory"],
): Promise<Bootstrapped> {
  const agents = new AgentRegistry();
  const tools = new ToolRegistry();
  const memory = new MemoryRegistry();
  const memoryProviders = memoryProvider === undefined
    ? [createInMemoryProvider()]
    : Array.isArray(memoryProvider) ? memoryProvider : [memoryProvider];
  for (const provider of memoryProviders) memory.register(provider);
  const evaluators = new EvaluatorRegistry();
  const events = new EventBus();
  const workflows = new Map<string, Workflow>();
  const policyRules = config.policyRules.map((rule) => {
    validatePolicyRule(rule);
    return { ...rule };
  });

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
    policies: {
      register(rule) {
        validatePolicyRule(rule);
        policyRules.push({ ...rule });
      },
    },
    commands: new CommandRegistry(),
    schemas: new SchemaRegistry(),
  };

  const installedPlugins: Plugin[] = [];
  try {
    for (const plugin of resolveOrder(config.plugins)) {
      await installPlugin(plugin, ctx);
      installedPlugins.push(plugin);
      events.emit("plugin.registered", { pluginId: plugin.id, version: plugin.version });
      events.emit("plugin.enabled", { pluginId: plugin.id });
    }
  } catch (error) {
    events.emit("plugin.failed", { error: error instanceof Error ? error.message : String(error) });
    await Promise.allSettled(installedPlugins.reverse().map((plugin) => stopPlugin(plugin, ctx)));
    throw error;
  }

  let pluginsStopped = false;
  return {
    agents,
    tools,
    memory,
    evaluators,
    events,
    workflows,
    policyRules,
    plugins: installedPlugins,
    async shutdownPlugins() {
      if (pluginsStopped) return;
      pluginsStopped = true;
      for (const plugin of [...installedPlugins].reverse()) {
        try {
          await stopPlugin(plugin, ctx);
          events.emit("plugin.disabled", { pluginId: plugin.id });
        } catch (error) {
          events.emit("plugin.failed", { pluginId: plugin.id, error: error instanceof Error ? error.message : String(error) });
        }
      }
    },
  };
}
