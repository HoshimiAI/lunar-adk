import type { Run } from "./types";
import { createRun } from "./lifecycle";

export function forkRun<Result>(run: Run<Result>): Run<Result> {
  const forked = createRun<Result>();
  return { ...forked, trace: [...run.trace], artifacts: [...run.artifacts] };
}
