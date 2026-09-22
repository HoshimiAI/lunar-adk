import { StorageConflictError, type Run, type RunStore, type Session, type SessionStore, type StorageBundle, type WorkflowRun, type WorkflowStore, type SaveOptions } from "@lunar/foundation";

export interface HttpStorageOptions {
  baseUrl: string;
  token?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
  maxAttempts?: number;
  retryDelayMs?: number;
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export class HttpStorageError extends Error {
  constructor(
    message: string,
    readonly resource: string,
    readonly id: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "HttpStorageError";
  }
}

type StoredRecord = { id: string; revision?: number };

function normalizeBaseUrl(baseUrl: string): string {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  if (!normalized) throw new Error("HTTP storage baseUrl is required");
  return normalized;
}

function isRetryable(status?: number): boolean {
  return status === undefined || status === 408 || status === 429 || (status !== undefined && status >= 500);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

class HttpStore<T extends StoredRecord> {
  private readonly baseUrl: string;
  private readonly fetcher: NonNullable<HttpStorageOptions["fetch"]>;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelayMs: number;
  private pending = new Set<Promise<unknown>>();

  constructor(private readonly resource: string, options: HttpStorageOptions) {
    this.baseUrl = normalizeBaseUrl(options.baseUrl);
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.headers = {
      accept: "application/json",
      ...options.headers,
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    };
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.maxAttempts = Math.max(1, options.maxAttempts ?? 3);
    this.retryDelayMs = Math.max(0, options.retryDelayMs ?? 100);
  }

  async save(value: T, options: SaveOptions = {}): Promise<T> {
    const saved = { ...value, revision: (options.expectedRevision ?? -1) + 1 } as T & { revision: number };
    await this.request(saved.id, "PUT", saved, options.expectedRevision, options.expectedRevision === undefined);
    return saved as T;
  }

  async get(id: string): Promise<T | undefined> {
    const response = await this.request(id, "GET");
    if (response === undefined) return undefined;
    return response as T;
  }

  async listRecoverable(): Promise<T[]> {
    const operation = this.listRecoverableWithRetry();
    this.pending.add(operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(operation);
    }
  }

  async close(): Promise<void> {
    await Promise.allSettled(this.pending);
  }

  private async request(id: string, method: "GET" | "PUT", value?: T, expectedRevision?: number, createOnly = false): Promise<unknown> {
    const operation = this.requestWithRetry(id, method, value, expectedRevision, createOnly);
    this.pending.add(operation);
    try {
      return await operation;
    } finally {
      this.pending.delete(operation);
    }
  }

  private async requestWithRetry(id: string, method: "GET" | "PUT", value?: T, expectedRevision?: number, createOnly = false): Promise<unknown> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
          response = await this.fetcher(`${this.baseUrl}/v1/${this.resource}/${encodeURIComponent(id)}`, {
            method,
            headers: {
              ...this.headers,
              ...(value === undefined ? {} : { "content-type": "application/json" }),
              ...(expectedRevision === undefined ? {} : { "if-match": String(expectedRevision) }),
              ...(createOnly ? { "if-none-match": "*" } : {}),
            },
            body: value === undefined ? undefined : JSON.stringify(value),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (response.status === 404 && method === "GET") return undefined;
        if (response.status === 409 || response.status === 412) {
          throw new StorageConflictError(this.resource, id, expectedRevision, undefined);
        }
        if (response.ok) {
          if (method === "GET") return await response.json();
          return undefined;
        }

        const message = await response.text();
        if (!isRetryable(response.status) || attempt === this.maxAttempts) {
          throw new HttpStorageError(
            `HTTP storage ${method} ${this.resource}/${id} failed: ${message || response.statusText}`,
            this.resource,
            id,
            response.status,
          );
        }
        lastError = new HttpStorageError(`HTTP storage request returned ${response.status}`, this.resource, id, response.status);
      } catch (error) {
        if (error instanceof StorageConflictError) throw error;
        if (error instanceof HttpStorageError && !isRetryable(error.status)) throw error;
        lastError = error;
        if (attempt === this.maxAttempts) {
          if (error instanceof HttpStorageError) throw error;
          throw new HttpStorageError(
            `HTTP storage ${method} ${this.resource}/${id} failed: ${error instanceof Error ? error.message : String(error)}`,
            this.resource,
            id,
          );
        }
      }
      await delay(this.retryDelayMs * 2 ** (attempt - 1));
    }
    throw lastError;
  }

  private async listRecoverableWithRetry(): Promise<T[]> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
        let response: Response;
        try {
          response = await this.fetcher(`${this.baseUrl}/v1/${this.resource}?status=running`, {
            method: "GET",
            headers: this.headers,
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }
        if (response.ok) {
          const values: unknown = await response.json();
          if (Array.isArray(values)) return values as T[];
          throw new HttpStorageError("HTTP storage recovery listing must return an array", this.resource, "*");
        }
        const error = new HttpStorageError(
          `HTTP storage GET ${this.resource}?status=running failed: ${await response.text() || response.statusText}`,
          this.resource,
          "*",
          response.status,
        );
        if (!isRetryable(response.status) || attempt === this.maxAttempts) throw error;
        lastError = error;
      } catch (error) {
        if (error instanceof HttpStorageError && !isRetryable(error.status)) throw error;
        lastError = error;
        if (attempt === this.maxAttempts) {
          if (error instanceof HttpStorageError) throw error;
          throw new HttpStorageError(
            `HTTP storage recovery listing failed: ${error instanceof Error ? error.message : String(error)}`,
            this.resource,
            "*",
          );
        }
      }
      await delay(this.retryDelayMs * 2 ** (attempt - 1));
    }
    throw lastError;
  }
}

export interface HttpStores extends StorageBundle {
  runStore: RunStore;
  sessionStore: SessionStore;
  workflowStore: WorkflowStore;
  close(): Promise<void>;
}

export function createHttpStores(options: HttpStorageOptions): HttpStores {
  const runs = new HttpStore<Run>("runs", options);
  const sessions = new HttpStore<Session>("sessions", options);
  const workflows = new HttpStore<WorkflowRun>("workflow-runs", options);
  return {
    capabilities: { optimisticConcurrency: true, atomicRunSession: false },
    runStore: runs,
    sessionStore: sessions,
    workflowStore: workflows,
    close: async () => {
      await Promise.all([runs.close(), sessions.close(), workflows.close()]);
    },
  };
}
