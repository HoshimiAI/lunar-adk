export const EVENT_NAMES = [
  "run.started",
  "run.completed",
  "run.failed",
  "run.cancelled",
  "model.called",
  "agent.started",
  "agent.completed",
  "agent.failed",
  "tool.started",
  "tool.completed",
  "tool.failed",
  "tool.approval_required",
  "workflow.started",
  "workflow.completed",
  "workflow.failed",
  "memory.created",
  "memory.retrieved",
  "plugin.registered",
  "plugin.enabled",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];
