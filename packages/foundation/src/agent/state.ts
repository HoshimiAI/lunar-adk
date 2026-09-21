import type { AgentState } from "./types";

const TRANSITIONS: Record<AgentState, AgentState[]> = {
  idle: ["running"],
  running: ["waiting", "done", "error"],
  waiting: ["running"],
  done: [],
  error: [],
};

export function canTransition(from: AgentState, to: AgentState): boolean {
  return TRANSITIONS[from].includes(to);
}
