import type { PluginContext } from "./context";
import type { PluginManifest } from "./manifest";

export interface Plugin extends PluginManifest {
  register(ctx: PluginContext): void | Promise<void>;
  start?(ctx: PluginContext): void | Promise<void>;
  stop?(ctx: PluginContext): void | Promise<void>;
}
