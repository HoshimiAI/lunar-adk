import type { Plugin } from "./types";

export class PluginRegistry {
  private plugins = new Map<string, Plugin>();

  register(plugin: Plugin): void {
    if (!plugin.id.trim()) throw new Error("Plugin id must not be empty");
    if (this.plugins.has(plugin.id)) throw new Error(`Plugin "${plugin.id}" is already registered`);
    this.plugins.set(plugin.id, plugin);
  }

  list(): Plugin[] {
    return [...this.plugins.values()];
  }
}
