import type { WorkflowStep } from "./types";
import { autoApprove, type ApprovalHandler } from "./approval";

export async function executeStep(step: WorkflowStep, approve: ApprovalHandler = autoApprove): Promise<unknown> {
  switch (step.kind) {
    case "sequential": {
      const results: unknown[] = [];
      for (const child of step.steps) results.push(await executeStep(child, approve));
      return results;
    }
    case "parallel":
      return Promise.all(step.steps.map((child) => executeStep(child, approve)));
    case "conditional": {
      const branch = step.condition(undefined) ? step.ifTrue : step.ifFalse;
      return branch ? executeStep(branch, approve) : undefined;
    }
    case "approval": {
      const approved = await approve(step.message);
      if (!approved) throw new Error(`Workflow step rejected: ${step.message}`);
      return executeStep(step.next, approve);
    }
    case "agent":
      return (await step.agent.run(step.input)).output;
  }
}
