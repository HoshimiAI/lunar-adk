import type { Run } from "./types";

export function replayEvents<Result>(run: Run<Result>, onEvent: (event: Run["events"][number]) => void): void {
  for (const event of run.events) onEvent(event);
}
