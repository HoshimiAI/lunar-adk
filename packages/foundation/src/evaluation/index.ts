import type { Evaluator } from "./types";

export { EvaluatorRegistry } from "./registry";
export { normalize } from "./score";
export type { Evaluator, EvaluationScore } from "./types";

export function defineEvaluator(evaluator: Evaluator): Evaluator {
  return evaluator;
}
