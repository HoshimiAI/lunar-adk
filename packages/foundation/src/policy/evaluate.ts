import { PolicyDeniedError, type PolicyEnforcer, type PolicyRule } from "./types";

export function validatePolicyRule(rule: PolicyRule): void {
  if (!rule.id.trim()) throw new Error("Policy rule id must not be empty");
  if (rule.name !== undefined && !rule.name.trim()) throw new Error(`Policy rule "${rule.id}" name must not be empty`);
}

/** Creates a first-match-wins, default-allow policy evaluator. */
export function createPolicyEnforcer(rules: readonly PolicyRule[] = []): PolicyEnforcer {
  for (const rule of rules) validatePolicyRule(rule);
  return (action, name) => {
    const rule = rules.find((candidate) => candidate.action === action && (candidate.name === undefined || candidate.name === name));
    if (rule?.effect === "deny") throw new PolicyDeniedError(rule, action, name);
  };
}
