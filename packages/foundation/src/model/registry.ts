import type { ModelProvider } from "./types";

export class ModelRegistry {
  private providers = new Map<string, ModelProvider>();

  register(provider: ModelProvider): void {
    this.providers.set(provider.id, provider);
  }

  get(id: string): ModelProvider {
    const provider = this.providers.get(id);
    if (!provider) throw new Error(`Unknown model provider: ${id}`);
    return provider;
  }
}
