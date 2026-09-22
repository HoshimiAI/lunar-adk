import type { ModelMessage } from "../model";
import type { Run } from "../run";

export interface Session {
  id: string;
  revision?: number;
  tenantId?: string;
  ownerId?: string;
  history: ModelMessage[];
  runIds?: string[];
  /** @deprecated Compatibility view containing run references. */
  runs?: Array<Pick<Run, "id">>;
}
