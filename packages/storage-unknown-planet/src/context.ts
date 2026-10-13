import {
  ContextScopeMismatchError,
  type ContextProvider,
  type ContextQuery,
  type SourceContextRecord,
} from "@lunar-adk/foundation/context";
import { PlanetCapabilityError, type Planet, type PlanetScope } from "@unknown-planet/sdk";

export interface UnknownPlanetContextOptions {
  /** An initialized SDK client configured with the desired Planet providers and routes. */
  planet: Planet;
  /** Explicit tenant/workspace scope for all retrieval performed by this provider. */
  scope: PlanetScope;
  id?: string;
}

/** Retrieves source-backed knowledge through an application-owned, scoped Planet client. */
export function createUnknownPlanetContextProvider(options: UnknownPlanetContextOptions): ContextProvider {
  if (!options.scope.tenantId.trim()) throw new Error("Unknown Planet context requires a non-empty tenantId.");
  const providerId = options.id ?? "unknown-planet";

  return {
    id: providerId,
    async retrieve(query: ContextQuery): Promise<SourceContextRecord[]> {
      const requestTenantId = query.tenantId ?? options.scope.tenantId;
      if (requestTenantId !== options.scope.tenantId) {
        throw new ContextScopeMismatchError();
      }
      const requestWorkspaceId = query.workspaceId ?? options.scope.workspaceId;
      if (options.scope.workspaceId !== undefined && requestWorkspaceId !== options.scope.workspaceId) {
        throw new ContextScopeMismatchError("Context provider workspace does not match the run workspace.");
      }
      const planet = options.planet.withScope({
        tenantId: requestTenantId,
        ...(requestWorkspaceId ? { workspaceId: requestWorkspaceId } : {}),
      });
      const limit = Number.isFinite(query.limit) ? Math.max(1, Math.min(Math.floor(query.limit), 100)) : 5;
      try {
        const results = await planet.query({
          text: query.text,
          limit,
          search: { keyword: true, vector: true, graph: true },
          includeEvidence: true,
        });
        return results.map((result) => {
          const relevantEdges = result.edges.filter(
            (edge) => edge.sourceId === result.node.id || edge.targetId === result.node.id,
          );
          const edgeIds = new Set(relevantEdges.map((edge) => edge.id));
          const evidence = result.evidence
            .filter((item) => edgeIds.size === 0 || edgeIds.has(item.edgeId))
            .map((item) => ({
              id: item.id,
              edgeId: item.edgeId,
              ...(item.direction !== undefined ? { direction: item.direction } : {}),
              ...(item.confidence !== undefined ? { confidence: item.confidence } : {}),
              ...(item.strength !== undefined ? { strength: item.strength } : {}),
              ...(item.sourceType !== undefined ? { sourceType: item.sourceType } : {}),
              ...(item.sourceId !== undefined ? { sourceId: item.sourceId } : {}),
              ...(item.documentId !== undefined ? { documentId: item.documentId } : {}),
              ...(item.chunkId !== undefined ? { chunkId: item.chunkId } : {}),
            }));
          const content =
            result.node.type === "document_chunk"
              ? result.node.name
              : JSON.stringify({
                  type: result.node.type,
                  name: result.node.name,
                  properties: result.node.properties,
                  edges: relevantEdges.map((edge) => ({
                    relation: edge.relation,
                    sourceId: edge.sourceId,
                    targetId: edge.targetId,
                    ...(edge.confidence !== undefined ? { confidence: edge.confidence } : {}),
                    ...(edge.status !== undefined ? { status: edge.status } : {}),
                  })),
                  evidence,
                });

          return {
            id: result.node.id,
            content,
            score: result.score,
            sources: result.sources.length
              ? result.sources.map((source) => ({ ...source }))
              : [{ type: "graph", id: result.node.id }],
          };
        });
      } catch (error) {
        if (error instanceof PlanetCapabilityError) return [];
        throw error;
      }
    },
  };
}

export type { ContextProvider, ContextQuery, SourceContextRecord };
