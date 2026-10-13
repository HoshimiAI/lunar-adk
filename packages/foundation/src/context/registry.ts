import type { ContextProvider } from "./types";

export class ContextRegistry {
  private providers = new Map<string, ContextProvider>();

  register(provider: ContextProvider): void {
    if (this.providers.has(provider.id)) throw new Error(`Context provider already registered: ${provider.id}`);
    this.providers.set(provider.id, provider);
  }

  get(id: string): ContextProvider | undefined {
    return this.providers.get(id);
  }

  list(): ContextProvider[] {
    return [...this.providers.values()];
  }
}
