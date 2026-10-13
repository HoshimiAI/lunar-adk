import type { ModelMessage } from "../model";

export interface ContextBudget {
  maxTokens: number;
}

export interface BuiltContext {
  messages: ModelMessage[];
  estimatedTokens: number;
}

export interface ContextSource {
  type?: string;
  id?: string;
  documentId?: string;
  chunkId?: string;
  title?: string;
  contentUri?: string;
  startOffset?: number;
  endOffset?: number;
}

export interface ContextSourceReference extends ContextSource {
  label: string;
}

export interface SourceContextRecord {
  id: string;
  content: string;
  score?: number;
  sources: ContextSource[];
}

export interface ContextQuery {
  text: string;
  limit: number;
  tenantId?: string;
  workspaceId?: string;
  ownerId?: string;
}

/** Retrieval contract for source-backed knowledge; separate from conversational memory. */
export interface ContextProvider {
  readonly id: string;
  retrieve(query: ContextQuery): Promise<SourceContextRecord[]>;
}

export interface RetrievedContextAttribution {
  providerId: string;
  sources: ContextSourceReference[];
}

export class ContextScopeMismatchError extends Error {
  constructor(message = "Context provider scope does not match the run scope.") {
    super(message);
    this.name = "ContextScopeMismatchError";
  }
}
