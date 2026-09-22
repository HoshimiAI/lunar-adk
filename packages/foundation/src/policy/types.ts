export type PolicyAction = "agent.run" | "workflow.run" | "tool.execute";

export interface PolicyRule {
  /** Stable identifier included in policy-denied errors. */
  id: string;
  effect: "allow" | "deny";
  action: PolicyAction;
  /** Exact agent, workflow, or tool name. Omit to match every name for the action. */
  name?: string;
}

export type PolicyEnforcer = (action: PolicyAction, name: string) => void;

export class PolicyDeniedError extends Error {
  constructor(
    public readonly rule: PolicyRule,
    public readonly action: PolicyAction,
    public readonly targetName: string,
  ) {
    super(`Policy rule "${rule.id}" denied ${action} for "${targetName}"`);
    this.name = "PolicyDeniedError";
  }
}
