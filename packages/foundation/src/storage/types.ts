import type { RunStore } from "../run";
import type { SessionStore } from "../session";
import type { WorkflowStore } from "../workflow";
import type { Run } from "../run";
import type { Session } from "../session";

export interface SaveOptions {
  expectedRevision?: number;
  expectedSessionRevision?: number;
}

export interface StorageBundle {
  runStore: RunStore;
  sessionStore: SessionStore;
  workflowStore: WorkflowStore;
  saveRunAndSession?(run: Run, session: Session, options?: SaveOptions): Promise<{ run: Run; session: Session }>;
  close?(): void | Promise<void>;
}
