import type { AgentRegistry } from "../agent";
import type { ToolRegistry } from "../tool";
import type { MemoryRegistry } from "../memory";
import type { EvaluatorRegistry } from "../evaluation";
import type { EventBus } from "../event";
import type { CommandRegistry, SchemaRegistry } from "./registries";
import type { Workflow } from "../workflow";
import type { PolicyRule } from "../policy";

export interface WorkflowRegistry {
  register(workflow: Workflow): void;
  register(id: string, run: () => Promise<unknown>): void;
}

export interface PolicyRegistry {
  /** Adds a rule after application rules and earlier dependency-ordered plugins. */
  register(rule: PolicyRule): void;
}

export interface PluginContext {
  agents: AgentRegistry;
  tools: ToolRegistry;
  memory: MemoryRegistry;
  workflows: WorkflowRegistry;
  policies: PolicyRegistry;
  evaluators: EvaluatorRegistry;
  events: EventBus;
  commands: CommandRegistry;
  schemas: SchemaRegistry;
}
