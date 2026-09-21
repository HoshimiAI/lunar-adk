import type { Session } from "./types";

export { appendMessage, appendRun } from "./history";
export type { Session } from "./types";

export function createSession(): Session {
  return { id: crypto.randomUUID(), history: [], runs: [] };
}
