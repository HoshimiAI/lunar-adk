import type { Plugin } from "./types";
import type { PluginContext } from "./context";

export async function installPlugin(plugin: Plugin, ctx: PluginContext): Promise<void> {
  await plugin.register(ctx);
  try {
    await plugin.start?.(ctx);
  } catch (error) {
    try {
      await plugin.stop?.(ctx);
    } catch {
      // Preserve the startup failure as the actionable error.
    }
    throw error;
  }
}

export async function stopPlugin(plugin: Plugin, ctx: PluginContext): Promise<void> {
  await plugin.stop?.(ctx);
}
