import type { Session } from "./types";

export { appendMessage, appendRun, upsertRun } from "./history";
export { InMemorySessionStore } from "./store";
export type { Session } from "./types";
export type { SessionStore } from "./store";

export function createSession(): Session {
  return { id: crypto.randomUUID(), history: [], runs: [] };
}
