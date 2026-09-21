export interface PluginPermissions {
  network?: boolean;
  filesystem?: boolean;
}

export function assertPermission(granted: PluginPermissions, needed: keyof PluginPermissions): void {
  if (!granted[needed]) throw new Error(`Missing plugin permission: ${needed}`);
}
