import type { EventName } from "./names";

export interface LunarEvent<Payload = unknown> {
  name: EventName;
  payload: Payload;
  timestamp: number;
}

export type EventHandler<Payload = unknown> = (event: LunarEvent<Payload>) => void | Promise<void>;
