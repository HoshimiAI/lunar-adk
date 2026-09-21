import type { ModelMessage } from "../model";
import type { Run } from "../run";

export interface Session {
  id: string;
  history: ModelMessage[];
  runs: Run[];
}
