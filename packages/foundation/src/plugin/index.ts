import type { Plugin } from "./types";

export { PluginRegistry } from "./registry";
export { installPlugin, stopPlugin } from "./lifecycle";
export { resolveOrder } from "./dependency";
export { assertPermission } from "./permission";
export { CommandRegistry, SchemaRegistry } from "./registries";
export type { PluginContext, PolicyRegistry, WorkflowRegistry } from "./context";
export type { PluginInfo, PluginManifest, PluginStatus } from "./manifest";
export type { PluginPermissions } from "./permission";
export type { Plugin } from "./types";

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
