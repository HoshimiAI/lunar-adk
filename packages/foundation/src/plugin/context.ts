import type { AgentRegistry } from "../agent";
import type { ToolRegistry } from "../tool";
import type { MemoryRegistry } from "../memory";
import type { EvaluatorRegistry } from "../evaluation";
import type { EventBus } from "../event";
import type { CommandRegistry, SchemaRegistry } from "./registries";
import type { Workflow } from "../workflow";

export interface WorkflowRegistry {
  register(workflow: Workflow): void;
  register(id: string, run: () => Promise<unknown>): void;
}

export interface PluginContext {
  agents: AgentRegistry;
  tools: ToolRegistry;
  memory: MemoryRegistry;
  workflows: WorkflowRegistry;
  evaluators: EvaluatorRegistry;
  events: EventBus;
  commands: CommandRegistry;
  schemas: SchemaRegistry;
}
