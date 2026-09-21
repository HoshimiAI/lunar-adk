import type { Plugin } from "./types";
import type { PluginContext } from "./context";

export async function installPlugin(plugin: Plugin, ctx: PluginContext): Promise<void> {
  await plugin.register(ctx);
}
