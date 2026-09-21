import type { MemoryProvider } from "./types";

export class MemoryRegistry {
  private providers = new Map<string, MemoryProvider>();

  register(provider: MemoryProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): MemoryProvider | undefined {
    return this.providers.get(id);
  }
}
