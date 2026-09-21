import type { WorkflowStep } from "./types";

export function parallel(steps: WorkflowStep[]): WorkflowStep {
  return { kind: "parallel", steps };
}
