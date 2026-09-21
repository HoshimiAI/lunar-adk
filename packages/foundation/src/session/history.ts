import type { ModelMessage } from "../model";
import type { Session } from "./types";
import type { Run } from "../run";

export function appendMessage(session: Session, message: ModelMessage): Session {
  return { ...session, history: [...session.history, message] };
}

export function appendRun(session: Session, run: Run): Session {
  return { ...session, runs: [...session.runs, run] };
}

export function upsertRun(session: Session, run: Run): Session {
  const index = session.runs.findIndex((storedRun) => storedRun.id === run.id);
  if (index < 0) return appendRun(session, run);
  const runs = [...session.runs];
  runs[index] = run;
  return { ...session, runs };
}
