import type { WorkflowStep } from "./types";

export function conditional(
  condition: (context: unknown) => boolean,
  ifTrue: WorkflowStep,
  ifFalse?: WorkflowStep,
): WorkflowStep {
  return { kind: "conditional", condition, ifTrue, ifFalse };
}
