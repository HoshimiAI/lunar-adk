import type { Evaluator } from "./types";

export class EvaluatorRegistry {
  private evaluators = new Map<string, Evaluator>();

  register(evaluator: Evaluator): void {
    this.evaluators.set(evaluator.id, evaluator);
  }

  list(): Evaluator[] {
    return [...this.evaluators.values()];
  }
}
