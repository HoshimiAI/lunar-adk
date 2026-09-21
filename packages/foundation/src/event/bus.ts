import type { EventName } from "./names";
import type { EventHandler, LunarEvent } from "./types";

export class EventBus {
  private handlers = new Map<EventName, Set<EventHandler>>();

  on<Payload = unknown>(name: EventName, handler: EventHandler<Payload>): () => void {
    const set = this.handlers.get(name) ?? new Set();
    set.add(handler as EventHandler);
    this.handlers.set(name, set);
    return () => set.delete(handler as EventHandler);
  }

  emit<Payload = unknown>(name: EventName, payload: Payload): void {
    const event: LunarEvent<Payload> = { name, payload, timestamp: Date.now() };
    for (const handler of this.handlers.get(name) ?? []) {
      void handler(event);
    }
  }
}
