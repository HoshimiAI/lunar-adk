export const EVENT_NAMES = [
  "run.started",
  "run.completed",
  "run.failed",
  "agent.started",
  "agent.completed",
  "agent.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "workflow.started",
  "workflow.completed",
  "memory.created",
  "memory.retrieved",
  "plugin.registered",
  "plugin.enabled",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
