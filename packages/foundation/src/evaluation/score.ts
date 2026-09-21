import type { EvaluationScore } from "./types";

export function normalize(score: EvaluationScore): number {
  return score.max === 0 ? 0 : score.value / score.max;
}
