import type { MemoryProvider } from "./types";

export class MemoryRegistry {
  private providers = new Map<string, MemoryProvider>();

  register(provider: MemoryProvider, options: { replace?: boolean } = {}): void {
    if (this.providers.has(provider.id) && !options.replace) {
      throw new Error(`Memory provider already registered: ${provider.id}`);
    }
    this.providers.set(provider.id, provider);
  }

  get(id: string): MemoryProvider | undefined {
    return this.providers.get(id);
  }

  list(): MemoryProvider[] {
    return [...this.providers.values()];
  }
}
