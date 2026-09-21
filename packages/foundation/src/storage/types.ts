import type { RunStore } from "../run";
import type { SessionStore } from "../session";
import type { WorkflowStore } from "../workflow";

export interface StorageBundle {
  runStore: RunStore;
  sessionStore: SessionStore;
  workflowStore: WorkflowStore;
  close?(): void | Promise<void>;
}
