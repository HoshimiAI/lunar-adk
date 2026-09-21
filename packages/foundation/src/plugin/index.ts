import type { Plugin } from "./types";

export { PluginRegistry } from "./registry";
export { installPlugin } from "./lifecycle";
export { resolveOrder } from "./dependency";
export { assertPermission } from "./permission";
export { CommandRegistry, SchemaRegistry } from "./registries";
export type { PluginContext, WorkflowRegistry } from "./context";
export type { PluginManifest } from "./manifest";
export type { PluginPermissions } from "./permission";
export type { Plugin } from "./types";

export function definePlugin(plugin: Plugin): Plugin {
  return plugin;
}
