import { Elysia, t } from "elysia";
import { AgentRunError, StorageConflictError, createRuntime, defineAgent } from "@lunar/adk";
import type { AuthPrincipal, AuthProvider, EmbeddingProvider, Run, RuntimeHandle, RuntimeStreamEvent, Session } from "@lunar/adk";
import { createOpenAIEmbeddingProvider, createOpenAIModelProvider } from "@lunar/provider-openai";
import { createSqliteStores } from "@lunar/storage-sqlite";
import { createHttpStores } from "@lunar/storage-http";
import { createBunSqlStores, type BunSqlDialect } from "@lunar/storage-bun-sql";
import { createBunSqlMemoryProvider } from "@lunar/memory-bun-sql";
import { createBetterAuthProvider, type BetterAuthLike, type BetterAuthSession } from "@lunar/auth-better-auth";
import { createConsoleExporter, createOTLPExporter } from "@lunar/observability-otel";
import { elysiaTools } from "./tools";

function encodeSse(event: string, data: unknown): Uint8Array {
  return new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function runMetrics(run: Run) {
  const durationMs = run.endedAt === undefined ? undefined : Math.max(0, run.endedAt - run.startedAt);
  const modelDurationMs = run.trace
    .filter((span) => span.kind === "model" && span.endedAt !== undefined)
    .reduce((total, span) => total + Math.max(0, span.endedAt! - span.startedAt), 0);
  const perSecond = (duration: number | undefined) => duration && duration > 0
    ? run.usage.outputTokens / (duration / 1_000)
    : undefined;
  return {
    usage: {
      ...run.usage,
      totalTokens: run.usage.inputTokens + run.usage.outputTokens,
    },
    metrics: {
      ...(durationMs !== undefined ? { durationMs, outputTokensPerSecond: perSecond(durationMs) } : {}),
      ...(modelDurationMs > 0 ? { modelDurationMs, modelOutputTokensPerSecond: perSecond(modelDurationMs) } : {}),
    },
  };
}

async function sessionUsage(session: Session, runtime: RuntimeHandle) {
  const runIds = [...new Set(session.runIds ?? session.runs?.map((run) => run.id) ?? [])];
  const runs = (await Promise.all(runIds.map((id) => runtime.getStoredRun(id))))
    .filter((run): run is Run => run !== undefined && run.sessionId === session.id);
  const inputTokens = runs.reduce((total, run) => total + run.usage.inputTokens, 0);
  const outputTokens = runs.reduce((total, run) => total + run.usage.outputTokens, 0);
  const durationMs = runs.reduce((total, run) => total + (run.endedAt === undefined ? 0 : Math.max(0, run.endedAt - run.startedAt)), 0);
  const modelDurationMs = runs.reduce((total, run) => total + run.trace
    .filter((span) => span.kind === "model" && span.endedAt !== undefined)
    .reduce((modelTotal, span) => modelTotal + Math.max(0, span.endedAt! - span.startedAt), 0), 0);
  const perSecond = (duration: number) => duration > 0 ? outputTokens / (duration / 1_000) : undefined;
  return {
    usage: { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens },
    metrics: {
      completedRuns: runs.filter((run) => run.endedAt !== undefined).length,
      ...(durationMs > 0 ? { durationMs, outputTokensPerSecond: perSecond(durationMs) } : {}),
      ...(modelDurationMs > 0 ? { modelDurationMs, modelOutputTokensPerSecond: perSecond(modelDurationMs) } : {}),
    },
  };
}

function toSse(event: RuntimeStreamEvent): { name: string; data: unknown } {
  if (event.type === "event") return { name: event.event.name, data: event.event };
  if (event.type === "text.delta") return { name: event.type, data: { runId: event.runId, text: event.text } };
  if (event.type === "stream.interrupted") return { name: event.type, data: event };
  if (event.type === "stream.completed") {
    return {
      name: event.type,
      data: {
        output: event.result.output,
        runId: event.result.run.id,
        sessionId: event.result.run.sessionId,
        status: event.result.run.status,
        pendingApproval: event.result.run.pendingApproval,
        ...runMetrics(event.result.run),
      },
    };
  }
  return {
    name: event.type,
    data: { error: event.error, runId: event.runId, code: event.code },
  };
}

export interface AppOptions {
  auth?: AuthProvider;
  ready?: () => Promise<void>;
  authHandler?: (request: Request) => Response | Promise<Response>;
  authRoutePrefix?: string;
  /** Used to create vectors for uploaded file chunks. */
  embedding?: EmbeddingProvider;
  /** Resume persisted running workflows before accepting requests. */
  recoverWorkflowsOnStartup?: boolean;
  rateLimit?: {
    /** Time to replenish a depleted quota bucket in milliseconds. */
    windowMs: number;
    /** Default request quota for each tenant (or the shared anonymous bucket). */
    maxRequests: number;
    /** Optional request quota overrides, keyed by authenticated tenant ID. */
    tenantQuotas?: Record<string, number>;
  };
  /** Provide a shared atomic store when multiple app instances must share quotas. */
  rateLimitStore?: RateLimitStore;
}

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const CHUNK_SIZE = 2_000;
const CHUNK_OVERLAP = 200;

function splitText(content: string): string[] {
  const chunks: string[] = [];
  for (let start = 0; start < content.length; start += CHUNK_SIZE - CHUNK_OVERLAP) {
    const chunk = content.slice(start, start + CHUNK_SIZE).trim();
    if (chunk) chunks.push(chunk);
  }
  return chunks;
}

function isTextFile(file: File): boolean {
  return file.type.startsWith("text/") || ["application/json", "application/xml", "application/javascript"].includes(file.type) || /\.(txt|md|mdx|csv|json|xml|html?|ya?ml)$/i.test(file.name);
}

export interface BetterAuthAppOptions<User = unknown, Session = unknown> extends Omit<AppOptions, "auth" | "authHandler"> {
  betterAuth: BetterAuthLike<User, Session> & { handler: (request: Request) => Response | Promise<Response> };
  mapPrincipal: (session: BetterAuthSession<User, Session>) => AuthPrincipal | undefined | Promise<AuthPrincipal | undefined>;
}

function can(principal: AuthPrincipal | undefined, permission: string): boolean {
  return principal?.permissions.includes(permission) === true || principal?.permissions.includes("*") === true;
}

function belongsToPrincipal(value: { tenantId?: string; ownerId?: string } | undefined, principal: AuthPrincipal | undefined): boolean {
  return !principal || (value?.tenantId === principal.tenantId && value.ownerId === principal.subjectId);
}

export interface RateLimitDecision {
  limit: number;
  remaining: number;
  resetAt: number;
  retryAfter?: number;
}

export interface RateLimitStore {
  consume(
    key: string,
    options: { limit: number; windowMs: number },
  ): RateLimitDecision | Promise<RateLimitDecision>;
}

export function createInMemoryRateLimitStore(maxEntries = 10_000): RateLimitStore {
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1) {
    throw new Error("Rate limit store capacity must be a positive safe integer");
  }
  const buckets = new Map<string, { tokens: number; updatedAt: number }>();
  return {
    consume(key, { limit, windowMs }) {
      if (!Number.isSafeInteger(limit) || limit < 1 || !Number.isSafeInteger(windowMs) || windowMs < 1) {
        throw new Error("Rate limit window and quotas must be positive safe integers");
      }
      const now = Date.now();
      const refill = (bucket: { tokens: number; updatedAt: number }) =>
        Math.min(limit, bucket.tokens + ((now - bucket.updatedAt) * limit) / windowMs);
      let bucket = buckets.get(key);
      if (bucket) {
        bucket.tokens = refill(bucket);
        bucket.updatedAt = now;
        if (bucket.tokens >= limit) {
          buckets.delete(key);
          bucket = undefined;
        }
      }
      if (!bucket && buckets.size >= maxEntries) {
        for (const [storedKey, storedBucket] of buckets) {
          if (refill(storedBucket) >= limit) buckets.delete(storedKey);
        }
        if (buckets.size >= maxEntries) {
          throw new Error("Rate limit store capacity exceeded");
        }
      }
      const tokens = bucket?.tokens ?? limit;
      const resetAt = now + ((limit - tokens) * windowMs) / limit;
      if (tokens < 1) {
        const retryAfter = Math.max(1, Math.ceil(((1 - tokens) * windowMs) / limit / 1000));
        buckets.set(key, { tokens, updatedAt: now });
        return {
          limit,
          remaining: 0,
          resetAt,
          retryAfter,
        };
      }
      const remaining = tokens - 1;
      if (remaining < limit) buckets.set(key, { tokens: remaining, updatedAt: now });
      return {
        limit,
        remaining: Math.floor(remaining),
        resetAt: now + ((limit - remaining) * windowMs) / limit,
      };
    },
  };
}

function createRateLimiter(config: AppOptions["rateLimit"], store?: RateLimitStore) {
  if (!config) return;
  const quotas = Object.values(config.tenantQuotas ?? {});
  const validLimits = [config.windowMs, config.maxRequests, ...quotas].every(
    (limit) => Number.isSafeInteger(limit) && limit > 0,
  );
  if (!validLimits) {
    throw new Error("Rate limit window and quotas must be positive safe integers");
  }

  const rateLimitStore = store ?? createInMemoryRateLimitStore();
  return (principal: AuthPrincipal | undefined) => {
    const tenantId = principal?.tenantId ?? "anonymous";
    const key = principal ? `tenant:${tenantId}` : "anonymous";
    const limit = config.tenantQuotas?.[tenantId] ?? config.maxRequests;
    return rateLimitStore.consume(key, { limit, windowMs: config.windowMs });
  };
}

export async function createApp(runtime: RuntimeHandle, options: AppOptions = {}) {
  const sessionAllowed = async (sessionId: string | undefined, principal: AuthPrincipal | undefined) => !sessionId || belongsToPrincipal(await runtime.getSession(sessionId), principal);
  const runAllowed = async (runId: string, principal: AuthPrincipal | undefined) => belongsToPrincipal(await runtime.getStoredRun(runId), principal);
  const workflowAllowed = async (runId: string, principal: AuthPrincipal | undefined) => belongsToPrincipal(await runtime.getWorkflowRun(runId), principal);
  const rateLimiter = createRateLimiter(options.rateLimit, options.rateLimitStore);
  const app = new Elysia();
  if (options.authHandler) app.mount(options.authHandler);
  const configuredApp = app
    .derive(async ({ request }) => ({ principal: options.auth ? await options.auth.authenticate(request) : undefined }))
    .onBeforeHandle(async ({ request, principal, set }) => {
      const path = new URL(request.url).pathname;
      const exempt = path === "/health" || path === "/readyz" || path.startsWith(options.authRoutePrefix ?? "/api/auth");
      if (options.auth && !exempt && !principal) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
      if (!rateLimiter || exempt) return;

      let rateLimit: RateLimitDecision;
      try {
        rateLimit = await rateLimiter(principal);
      } catch {
        set.status = 503;
        return { error: "Rate limiter unavailable" };
      }
      set.headers["X-RateLimit-Limit"] = String(rateLimit.limit);
      set.headers["X-RateLimit-Remaining"] = String(rateLimit.remaining);
      set.headers["X-RateLimit-Reset"] = String(Math.ceil(rateLimit.resetAt / 1000));
      if (rateLimit.retryAfter !== undefined) {
        set.status = 429;
        set.headers["Retry-After"] = String(rateLimit.retryAfter);
        return { error: "Rate limit exceeded", tenantId: principal?.tenantId };
      }
    })
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "Invalid request", details: error.message };
      }
      if (error instanceof AgentRunError) {
        set.status = error.code === "CANCELLED" ? 409 : error.code === "POLICY_DENIED" ? 403 : 500;
        return { error: error.message, runId: error.run.id };
      }
      if (error instanceof StorageConflictError) {
        set.status = 409;
        return { error: error.message, resource: error.resource, id: error.id };
      }
      if (error instanceof Error && (error.message === "Run not found" || error.message === "Session not found")) {
        set.status = 404;
        return { error: error.message };
      }
      if (error instanceof Error && error.message === "Workflow run not found") {
        set.status = 404;
        return { error: error.message };
      }
      if (error instanceof Error && error.message.startsWith("Unknown workflow:")) {
        set.status = 404;
        return { error: error.message };
      }
      if (error instanceof Error && (error.message === "Approval is no longer pending" || error.message === "Workflow is not waiting for approval")) {
        set.status = 409;
        return { error: error.message };
      }
    })
    .get("/health", () => ({ name: "lunar-elysia", status: "ok" }))
    .get("/plugins", () => ({ plugins: runtime.listPlugins() }))
    .get("/readyz", async ({ set }) => {
      try {
        await options.ready?.();
        return { name: "lunar-elysia", status: "ready" };
      } catch {
        set.status = 503;
        return { name: "lunar-elysia", status: "unavailable" };
      }
    })
    .post(
      "/run/stream",
      async ({ body, request, set, principal }) => {
        if (!(await sessionAllowed(body.sessionId, principal))) { set.status = 404; return { error: "Session not found" }; }
        if (!runtime.supportsStreaming("assistant")) {
          set.status = 501;
          return { error: "Streaming is not supported by the configured model", code: "STREAMING_UNSUPPORTED" };
        }

        const stream = runtime.stream("assistant", body.input, {
          sessionId: body.sessionId,
          tenantId: principal?.tenantId,
          ownerId: principal?.subjectId,
          signal: request.signal,
        });
        const responseStream = new ReadableStream<Uint8Array>({
          async start(controller) {
            try {
              for await (const event of stream) {
                const encoded = toSse(event);
                controller.enqueue(encodeSse(encoded.name, encoded.data));
              }
            } catch (error) {
              controller.enqueue(encodeSse("stream.error", {
                error: error instanceof Error ? error.message : String(error),
              }));
            } finally {
              controller.close();
            }
          },
        });
        return new Response(responseStream, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      },
      {
        body: t.Object({
          input: t.String({ minLength: 1, maxLength: 32_000 }),
          sessionId: t.Optional(t.String()),
        }),
      },
    )
    .get("/runs/:id", async ({ params, set, principal }) => {
      const run = await runtime.getStoredRun(params.id);
      if (!run || !belongsToPrincipal(run, principal)) {
        set.status = 404;
        return { error: "Run not found" };
      }
      return { ...run, ...runMetrics(run) };
    })
    .get("/sessions/:id", async ({ params, set, principal }) => {
      const session = await runtime.getSession(params.id);
      if (!session || !belongsToPrincipal(session, principal)) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return { ...session, ...(await sessionUsage(session, runtime)) };
    })
    .post(
      "/workflows/:name/run",
      async ({ params, body, principal }) => {
        const run = await runtime.runWorkflow(params.name, body.input, { tenantId: principal?.tenantId, ownerId: principal?.subjectId });
        return { workflowRunId: run.id, status: run.status, output: run.output, pendingApproval: run.pendingApproval };
      },
      { body: t.Object({ input: t.Optional(t.Unknown()) }) },
    )
    .get("/workflow-runs/:id", async ({ params, set, principal }) => {
      const run = await runtime.getWorkflowRun(params.id);
      if (!run || !belongsToPrincipal(run, principal)) {
        set.status = 404;
        return { error: "Workflow run not found" };
      }
      return run;
    })
    .post("/workflow-runs/:id/cancel", async ({ params, set, principal }) => {
      if (!(await workflowAllowed(params.id, principal))) { set.status = 404; return { error: "Workflow run not found" }; }
      const run = await runtime.cancelWorkflow(params.id);
      if (!run) {
        set.status = 404;
        return { error: "Workflow run not found" };
      }
      return run;
    })
    .post(
      "/workflow-runs/:id/resume",
      async ({ params, body, set, principal }) => {
        if (!(await workflowAllowed(params.id, principal))) { set.status = 404; return { error: "Workflow run not found" }; }
        const run = await runtime.resumeWorkflow(params.id, body.approvalId);
        return { workflowRunId: run.id, status: run.status, output: run.output, pendingApproval: run.pendingApproval };
      },
      { body: t.Object({ approvalId: t.Optional(t.String({ minLength: 1 })) }) },
    )
    .post("/runs/:id/cancel", async ({ params, set, principal }) => {
      if (!(await runAllowed(params.id, principal))) { set.status = 404; return { error: "Run not found" }; }
      const run = await runtime.cancel(params.id);
      if (!run) {
        set.status = 404;
        return { error: "Run not found" };
      }
      return run;
    })
    .post(
      "/runs/:id/approve",
      async ({ params, body, set, principal }) => {
        if (!(await runAllowed(params.id, principal))) { set.status = 404; return { error: "Run not found" }; }
        const result = await runtime.approve(params.id, body.approvalId);
        return {
          runId: result.run.id,
          status: result.run.status,
          output: result.output,
          pendingApproval: result.run.pendingApproval,
        };
      },
      { body: t.Object({ approvalId: t.String({ minLength: 1 }) }) },
    )
    .post(
      "/runs/:id/reject",
      async ({ params, body, set, principal }) => {
        if (!(await runAllowed(params.id, principal))) { set.status = 404; return { error: "Run not found" }; }
        const run = await runtime.reject(params.id, body.approvalId);
        return run;
      },
      { body: t.Object({ approvalId: t.String({ minLength: 1 }) }) },
    )
    .post(
      "/sessions/:id/steer",
      async ({ params, body, set, principal }) => {
        if (!(await sessionAllowed(params.id, principal))) { set.status = 404; return { error: "Session not found" }; }
        const result = await runtime.steer(params.id, body.instruction);
        if ("status" in result) {
          set.status = 202;
          return result;
        }
        const session = result;
        return { sessionId: session.id, steered: true };
      },
      {
        body: t.Object({ instruction: t.String({ minLength: 1, maxLength: 4_000 }) }),
      },
    )
    .post(
      "/memories",
      async ({ body, principal, set }) => {
        if (!can(principal, "memory:write")) { set.status = 403; return { error: "Forbidden" }; }
        const provider = runtime.getMemoryProvider();
        if (!provider) { set.status = 404; return { error: "Memory is not configured" }; }
        const expiresAt = new Date(body.expiresAt).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) { set.status = 422; return { error: "expiresAt must be in the future" }; }
        const record = await provider.store({ content: body.content, namespace: body.namespace, metadata: body.metadata, tenantId: principal!.tenantId, ownerId: principal!.subjectId, expiresAt });
        set.status = 201;
        return record;
      },
      { body: t.Object({ content: t.String({ minLength: 1, maxLength: 32_000 }), expiresAt: t.String(), namespace: t.Optional(t.String()), metadata: t.Optional(t.Record(t.String(), t.Unknown())) }) },
    )
    .post(
      "/memories/upload",
      async ({ body, principal, set }) => {
        if (!can(principal, "memory:write")) { set.status = 403; return { error: "Forbidden" }; }
        const provider = runtime.getMemoryProvider();
        if (!provider) { set.status = 404; return { error: "Memory is not configured" }; }
        if (!isTextFile(body.file)) { set.status = 415; return { error: "Only UTF-8 text files are supported" }; }
        if (body.file.size > MAX_UPLOAD_BYTES) { set.status = 413; return { error: "File exceeds the 5 MiB limit" }; }
        const expiresAt = new Date(body.expiresAt).getTime();
        if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) { set.status = 422; return { error: "expiresAt must be in the future" }; }
        const content = await body.file.text();
        const chunks = splitText(content);
        if (chunks.length === 0) { set.status = 422; return { error: "File does not contain text" }; }
        const sourceId = crypto.randomUUID();
        const records = await Promise.all(chunks.map(async (chunk, index) => provider.store({
          content: chunk,
          namespace: body.namespace,
          tenantId: principal!.tenantId,
          ownerId: principal!.subjectId,
          expiresAt,
          ...(options.embedding ? { embedding: await options.embedding.embed(chunk) } : {}),
          metadata: {
            sourceId,
            filename: body.file.name,
            mimeType: body.file.type || "text/plain",
            chunkIndex: index,
            chunkCount: chunks.length,
            ...(options.embedding ? { embeddingModel: options.embedding.id } : {}),
          },
        })));
        set.status = 201;
        return { sourceId, filename: body.file.name, chunks: records.length, embedded: Boolean(options.embedding), records };
      },
      { body: t.Object({ file: t.File(), expiresAt: t.String(), namespace: t.Optional(t.String()) }) },
    )
    .get("/memories", async ({ query, principal, set }) => {
      if (!can(principal, "memory:read")) { set.status = 403; return { error: "Forbidden" }; }
      const provider = runtime.getMemoryProvider();
      if (!provider?.list) { set.status = 404; return { error: "Memory listing is not configured" }; }
      return provider.list({ tenantId: principal!.tenantId, ownerId: principal!.subjectId, namespace: query.namespace, cursor: query.cursor, limit: query.limit ? Number(query.limit) : undefined });
    }, { query: t.Object({ namespace: t.Optional(t.String()), cursor: t.Optional(t.String()), limit: t.Optional(t.String()) }) })
    .delete("/memories/:id", async ({ params, principal, set }) => {
      if (!can(principal, "memory:delete")) { set.status = 403; return { error: "Forbidden" }; }
      const removed = await runtime.getMemoryProvider()?.delete?.(params.id, principal!.tenantId, principal!.subjectId);
      if (!removed) { set.status = 404; return { error: "Memory not found" }; }
      return { id: params.id, deleted: true };
    })
    .post(
      "/run",
      async ({ body, principal, set }) => {
        if (!(await sessionAllowed(body.sessionId, principal))) { set.status = 404; return { error: "Session not found" }; }
        const result = await runtime.run("assistant", body.input, {
          sessionId: body.sessionId,
          tenantId: principal?.tenantId,
          ownerId: principal?.subjectId,
        });
        return {
          output: result.output,
          runId: result.run.id,
          sessionId: result.run.sessionId,
          status: result.run.status,
          pendingApproval: result.run.pendingApproval,
          ...runMetrics(result.run),
        };
      },
      {
        body: t.Object({
          input: t.String({ minLength: 1, maxLength: 32_000 }),
          sessionId: t.Optional(t.String()),
        }),
      },
    );
  if (options.recoverWorkflowsOnStartup) await runtime.recoverWorkflows();
  return configuredApp;
}

export async function createAppWithBetterAuth<User = unknown, Session = unknown>(
  runtime: RuntimeHandle,
  options: BetterAuthAppOptions<User, Session>,
) {
  return createApp(runtime, {
    ...options,
    auth: createBetterAuthProvider(options.betterAuth, options.mapPrincipal),
    authHandler: options.betterAuth.handler,
  });
}

function rateLimitFromEnvironment(): AppOptions["rateLimit"] {
  const maxRequestsValue = process.env.RATE_LIMIT_MAX_REQUESTS;
  const windowMsValue = process.env.RATE_LIMIT_WINDOW_MS;
  const tenantQuotasValue = process.env.RATE_LIMIT_TENANT_QUOTAS;
  if (maxRequestsValue === undefined && windowMsValue === undefined && tenantQuotasValue === undefined) return;
  if (maxRequestsValue === undefined) {
    throw new Error("RATE_LIMIT_MAX_REQUESTS is required when rate-limit environment settings are used");
  }

  const parsePositiveInteger = (name: string, value: string | undefined, fallback?: number) => {
    if (value === undefined && fallback !== undefined) return fallback;
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) {
      throw new Error(`${name} must be a positive safe integer`);
    }
    return Number(value);
  };

  let tenantQuotas: Record<string, number> | undefined;
  if (tenantQuotasValue !== undefined) {
    try {
      const parsed: unknown = JSON.parse(tenantQuotasValue);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      tenantQuotas = parsed as Record<string, number>;
    } catch {
      throw new Error("RATE_LIMIT_TENANT_QUOTAS must be a JSON object of tenant IDs to request limits");
    }
  }

  return {
    maxRequests: parsePositiveInteger("RATE_LIMIT_MAX_REQUESTS", maxRequestsValue),
    windowMs: parsePositiveInteger("RATE_LIMIT_WINDOW_MS", windowMsValue, 60_000),
    ...(tenantQuotas ? { tenantQuotas } : {}),
  };
}

export async function createDefaultApp(options: AppOptions = {}) {
  const rateLimit = options.rateLimit ?? rateLimitFromEnvironment();
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required to start the Elysia app");
  }

  const storageProvider = process.env.STORAGE_PROVIDER ?? "sqlite";
  if (!["sqlite", "postgres", "mysql", "http"].includes(storageProvider)) {
    throw new Error(`Unsupported STORAGE_PROVIDER: ${storageProvider}`);
  }
  const storage = storageProvider === "http"
    ? createHttpStores({
        baseUrl: process.env.STORAGE_HTTP_BASE_URL ?? (() => { throw new Error("STORAGE_HTTP_BASE_URL is required when STORAGE_PROVIDER=http"); })(),
        token: process.env.STORAGE_HTTP_TOKEN,
      })
    : storageProvider === "sqlite"
      ? createSqliteStores(process.env.SQLITE_PATH ?? "lunar.db")
      : await createBunSqlStores({
          connection: process.env.DATABASE_URL ?? (() => { throw new Error("DATABASE_URL is required for SQL remote storage"); })(),
          dialect: storageProvider as BunSqlDialect,
        });
  const memoryProviderName = process.env.MEMORY_PROVIDER;
  if (memoryProviderName !== undefined && memoryProviderName !== "postgres") {
    throw new Error(`Unsupported MEMORY_PROVIDER: ${memoryProviderName}`);
  }
  const memoryProvider = memoryProviderName === "postgres"
    ? await createBunSqlMemoryProvider({ connection: process.env.MEMORY_DATABASE_URL ?? process.env.DATABASE_URL ?? (() => { throw new Error("MEMORY_DATABASE_URL or DATABASE_URL is required when MEMORY_PROVIDER=postgres"); })() })
    : undefined;
  const embedding = createOpenAIEmbeddingProvider({
    apiKey,
    model: process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
  });
  const exporters = [];
  if (process.env.LUNAR_TELEMETRY === "console") exporters.push(createConsoleExporter());
  const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ?? process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  if (otlpEndpoint) exporters.push(createOTLPExporter({
    endpoint: otlpEndpoint.endsWith("/v1/traces") ? otlpEndpoint : `${otlpEndpoint.replace(/\/$/, "")}/v1/traces`,
    serviceName: process.env.OTEL_SERVICE_NAME ?? "lunar-elysia",
  }));
  const runtime = await createRuntime({
    storage,
    ownsStorage: true,
    ...(memoryProvider ? { memory: memoryProvider, ownsMemory: true } : {}),
    embedding,
    observability: {
      exporters,
      captureContent: process.env.LUNAR_TELEMETRY_CAPTURE_CONTENT === "true",
    },
  });
  runtime.registerAgent(
    defineAgent({
      name: "assistant",
      model: createOpenAIModelProvider({
        model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
        apiKey,
      }),
      systemPrompt: "You are a helpful assistant. Use current_time for the current UTC time and calculate for arithmetic instead of guessing.",
      tools: elysiaTools,
      ...(memoryProvider ? { memory: { providerId: memoryProvider.id, namespace: process.env.MEMORY_NAMESPACE ?? "assistant", retrieveLimit: Number(process.env.MEMORY_RETRIEVE_LIMIT ?? 5), store: "none" as const } } : {}),
    }),
  );

  return (await createApp(runtime, {
    ...options,
    rateLimit,
    embedding: options.embedding ?? embedding,
    ready: async () => {
      await storage.health?.();
      await memoryProvider?.health();
    },
  })).onStop(async () => {
    await runtime.shutdown?.();
  });
}
