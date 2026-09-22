export interface PluginManifest {
  id: string;
  version: string;
  description?: string;
  dependencies?: string[];
}

export type PluginStatus = "enabled" | "disabled";

export interface PluginInfo extends PluginManifest {
  status: PluginStatus;
}
