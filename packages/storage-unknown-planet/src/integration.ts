import type { Planet, PlanetScope } from "@unknown-planet/sdk";
import { createUnknownPlanetContextProvider, type UnknownPlanetContextOptions } from "./context.js";
import { createUnknownPlanetMemoryProvider, type UnknownPlanetMemoryOptions } from "./memory.js";
import { createUnknownPlanetStorage } from "./index.js";

export interface UnknownPlanetIntegrationOptions {
  /** Initialized application-owned client. Its providers and connection remain caller-owned. */
  planet: Planet;
  /** Tenant/workspace bound to every adapter returned by this factory. */
  scope: PlanetScope;
  /** Opt into SQL run/session/workflow storage. Run the migration separately before use. */
  storage?: boolean;
  /** Opt into Planet memory; pass writeMode `persist` when another system owns ingestion. */
  memory?: Omit<UnknownPlanetMemoryOptions, "planet" | "scope"> | false;
  /** Opt into source-aware knowledge retrieval. */
  context?: Omit<UnknownPlanetContextOptions, "planet" | "scope"> | false;
}

/**
 * Builds the selected Lunar adapters from one caller-owned Planet client and scope.
 * No providers are created unless explicitly selected, and this helper never migrates storage.
 */
export function createUnknownPlanetAdapters(options: UnknownPlanetIntegrationOptions) {
  if (!options.storage && !options.memory && !options.context) {
    throw new Error("Select at least one Unknown Planet adapter: storage, memory, or context.");
  }

  return {
    ...(options.storage ? { storage: createUnknownPlanetStorage(options) } : {}),
    ...(options.memory ? { memory: createUnknownPlanetMemoryProvider({ ...options.memory, planet: options.planet, scope: options.scope }) } : {}),
    ...(options.context ? { context: createUnknownPlanetContextProvider({ ...options.context, planet: options.planet, scope: options.scope }) } : {}),
  };
}
