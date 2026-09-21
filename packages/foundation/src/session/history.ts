import type { ModelMessage } from "../model";
import type { Session } from "./types";
import type { Run } from "../run";

export function appendMessage(session: Session, message: ModelMessage): Session {
  return { ...session, history: [...session.history, message] };
}

export function appendRun(session: Session, run: Run): Session {
  const runIds = session.runIds ?? session.runs?.map((storedRun) => storedRun.id) ?? [];
  const nextRunIds = [...runIds, run.id];
  return { ...session, runIds: nextRunIds, runs: nextRunIds.map((id) => ({ id })) };
}

export function upsertRun(session: Session, run: Run): Session {
  const runIds = session.runIds ?? session.runs?.map((storedRun) => storedRun.id) ?? [];
  const nextRunIds = runIds.includes(run.id) ? runIds : [...runIds, run.id];
  return { ...session, runIds: nextRunIds, runs: nextRunIds.map((id) => ({ id })) };
}

export function normalizeSession(session: Session): Session {
  return {
    ...session,
    runIds: session.runIds ?? session.runs?.map((run) => run.id) ?? [],
    runs: (session.runs ?? session.runIds?.map((id) => ({ id })))?.map((run) => ({ id: run.id })),
  };
}
