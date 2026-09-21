import type { Plugin } from "./types";

export function resolveOrder(plugins: Plugin[]): Plugin[] {
  const byId = new Map(plugins.map((p) => [p.id, p]));
  const visited = new Set<string>();
  const ordered: Plugin[] = [];

  function visit(plugin: Plugin) {
    if (visited.has(plugin.id)) return;
    visited.add(plugin.id);
    for (const depId of plugin.dependencies ?? []) {
      const dep = byId.get(depId);
      if (!dep) throw new Error(`Plugin "${plugin.id}" depends on unknown plugin "${depId}"`);
      visit(dep);
    }
    ordered.push(plugin);
  }

  for (const plugin of plugins) visit(plugin);
  return ordered;
}
