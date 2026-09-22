import type { Plugin } from "./types";

export function resolveOrder(plugins: Plugin[]): Plugin[] {
  const byId = new Map<string, Plugin>();
  for (const plugin of plugins) {
    if (!plugin.id.trim()) throw new Error("Plugin id must not be empty");
    if (byId.has(plugin.id)) throw new Error(`Duplicate plugin id "${plugin.id}"`);
    byId.set(plugin.id, plugin);
  }

  const visited = new Set<string>();
  const visiting = new Set<string>();
  const ordered: Plugin[] = [];

  function visit(plugin: Plugin) {
    if (visited.has(plugin.id)) return;
    if (visiting.has(plugin.id)) throw new Error(`Circular plugin dependency involving "${plugin.id}"`);
    visiting.add(plugin.id);
    for (const depId of plugin.dependencies ?? []) {
      if (depId === plugin.id) throw new Error(`Plugin "${plugin.id}" cannot depend on itself`);
      const dep = byId.get(depId);
      if (!dep) throw new Error(`Plugin "${plugin.id}" depends on unknown plugin "${depId}"`);
      visit(dep);
    }
    visiting.delete(plugin.id);
    visited.add(plugin.id);
    ordered.push(plugin);
  }

  for (const plugin of plugins) visit(plugin);
  return ordered;
}
