import type { WorkflowConfig, Workflow } from "./types";
import { executeStep } from "./resume";

export { sequential } from "./sequential";
export { parallel } from "./parallel";
export { conditional } from "./conditional";
export { autoApprove } from "./approval";
export type { ApprovalHandler } from "./approval";
export { executeStep } from "./resume";
export type { WorkflowStep, WorkflowConfig, Workflow } from "./types";

export function defineWorkflow(config: WorkflowConfig): Workflow {
  return {
    name: config.name,
    run: () => executeStep(config.root),
  };
}
