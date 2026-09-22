import type { RunStore } from "../run";
import type { SessionStore } from "../session";
import type { WorkflowStore } from "../workflow";
import type { Run } from "../run";
import type { Session } from "../session";

export interface SaveOptions {
  /** Omit only when creating a new record. Updates must supply the last observed revision. */
  expectedRevision?: number;
  expectedSessionRevision?: number;
}

export interface StorageCapabilities {
  optimisticConcurrency: true;
  atomicRunSession: boolean;
}

export interface StorageBundle {
  readonly capabilities?: StorageCapabilities;
  runStore: RunStore;
  sessionStore: SessionStore;
  workflowStore: WorkflowStore;
  saveRunAndSession?(run: Run, session: Session, options?: SaveOptions): Promise<{ run: Run; session: Session }>;
  close?(): void | Promise<void>;
}
