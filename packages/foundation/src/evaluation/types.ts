import type { Run } from "../run";

export interface EvaluationScore {
  name: string;
  value: number;
  max: number;
}

export interface Evaluator {
  id: string;
  evaluate(run: Run): Promise<EvaluationScore> | EvaluationScore;
}
