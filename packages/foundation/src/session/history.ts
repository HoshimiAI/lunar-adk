import type { ModelMessage } from "../model";
import type { Session } from "./types";
import type { Run } from "../run";

export function appendMessage(session: Session, message: ModelMessage): Session {
  return { ...session, history: [...session.history, message] };
}

export function appendRun(session: Session, run: Run): Session {
  return { ...session, runs: [...session.runs, run] };
}
