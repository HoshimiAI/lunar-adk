import type { Plugin } from "./types";

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    this.plugins.set(plugin.id, plugin);
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }
}
