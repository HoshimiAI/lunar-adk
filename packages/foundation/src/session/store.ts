import type { Session } from "./types";
import type { SaveOptions } from "../storage/types";
import { StorageConflictError } from "../storage/error";

export interface SessionStore {
  save(session: Session, options?: SaveOptions): Promise<Session>;
  get(id: string): Promise<Session | undefined>;
}

export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, Session>();

  async save(session: Session, options: SaveOptions = {}): Promise<Session> {
    const current = this.sessions.get(session.id);
    if (options.expectedRevision === undefined && current) {
      throw new StorageConflictError("sessions", session.id, undefined, current.revision);
    }
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
      throw new StorageConflictError("sessions", session.id, options.expectedRevision, current?.revision);
    }
    const saved = { ...session, revision: (current?.revision ?? -1) + 1 };
    this.sessions.set(session.id, saved);
    return saved;
  }

  async get(id: string): Promise<Session | undefined> {
    return this.sessions.get(id);
  }
}
