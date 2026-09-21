import type { WorkflowStep } from "./types";

export function sequential(steps: WorkflowStep[]): WorkflowStep {
  return { kind: "sequential", steps };
}
