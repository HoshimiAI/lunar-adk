import type { Session } from "./types";

export { appendMessage, appendRun, normalizeSession, upsertRun } from "./history";
export { InMemorySessionStore } from "./store";
export type { Session } from "./types";
export type { SessionStore } from "./store";

export function createSession(tenantId?: string, ownerId?: string): Session {
  return { id: crypto.randomUUID(), ...(tenantId ? { tenantId } : {}), ...(ownerId ? { ownerId } : {}), history: [], runIds: [], runs: [] };
}
