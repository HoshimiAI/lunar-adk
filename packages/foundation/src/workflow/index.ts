import type { WorkflowConfig, Workflow } from "./types";
import { executeStep } from "./resume";

export { sequential } from "./sequential";
export { parallel } from "./parallel";
export { conditional } from "./conditional";
export { autoApprove } from "./approval";
export type { ApprovalHandler } from "./approval";
export { executeStep } from "./resume";
export { InMemoryWorkflowStore } from "./store";
export type { WorkflowStore } from "./store";
export type {
  WorkflowStep,
  WorkflowConfig,
  Workflow,
  WorkflowContext,
  WorkflowRun,
  WorkflowStatus,
  WorkflowCheckpoint,
  WorkflowApproval,
  WorkflowRuntimeConfig,
} from "./types";
export { WorkflowApprovalRequired } from "./types";

export function defineWorkflow(config: WorkflowConfig): Workflow {
  if (!config.run && !config.root) throw new Error(`Workflow "${config.name}" requires run or root`);
  return {
    name: config.name,
    version: config.version ?? "1",
    run: config.run ?? (() => executeStep(config.root!)),
  };
}
