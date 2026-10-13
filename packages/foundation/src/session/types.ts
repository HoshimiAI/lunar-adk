import type { ModelMessage } from "../model";
import type { Run } from "../run";

export interface Session {
  id: string;
  revision?: number;
  tenantId?: string;
  workspaceId?: string;
  ownerId?: string;
  /** Optional user-facing label for session pickers and logs. */
  title?: string;
  /** Session this branch copied its initial conversation from. */
  parentSessionId?: string;
  history: ModelMessage[];
  runIds?: string[];
  /** @deprecated Compatibility view containing run references. */
  runs?: Array<Pick<Run, "id">>;
}
