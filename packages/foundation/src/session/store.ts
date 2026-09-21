import type { Session } from "./types";

export interface SessionStore {
  save(session: Session): Promise<void>;
  get(id: string): Promise<Session | undefined>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async save(session: Session): Promise<void> {
    this.sessions.set(session.id, session);
  }

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }
}
