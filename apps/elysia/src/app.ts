import { Elysia, t } from "elysia";
import { AgentRunError, StorageConflictError, createRuntime, defineAgent } from "@lunar/adk";
import type { AuthPrincipal, AuthProvider, RuntimeHandle, RuntimeStreamEvent } from "@lunar/adk";
import { createOpenAIModelProvider } from "@lunar/provider-openai";
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
}

export interface BetterAuthAppOptions<User = unknown, Session = unknown> extends Omit<AppOptions, "auth" | "authHandler"> {
  betterAuth: BetterAuthLike<User, Session> & { handler: (request: Request) => Response | Promise<Response> };
  mapPrincipal: (session: BetterAuthSession<User, Session>) => AuthPrincipal | undefined | Promise<AuthPrincipal | undefined>;
}

function can(principal: AuthPrincipal | undefined, permission: string): boolean {
  return principal?.permissions.includes(permission) === true || principal?.permissions.includes("*") === true;
}

function belongsToTenant(value: { tenantId?: string } | undefined, principal: AuthPrincipal | undefined): boolean {
  return !principal || value?.tenantId === principal.tenantId;
}

export async function createApp(runtime: RuntimeHandle, options: AppOptions = {}) {
  const sessionAllowed = async (sessionId: string | undefined, principal: AuthPrincipal | undefined) => !sessionId || belongsToTenant(await runtime.getSession(sessionId), principal);
  const runAllowed = async (runId: string, principal: AuthPrincipal | undefined) => belongsToTenant(await runtime.getStoredRun(runId), principal);
  const workflowAllowed = async (runId: string, principal: AuthPrincipal | undefined) => belongsToTenant(await runtime.getWorkflowRun(runId), principal);
  const app = new Elysia();
  if (options.authHandler) app.mount(options.authHandler);
  return app
    .derive(async ({ request }) => ({ principal: options.auth ? await options.auth.authenticate(request) : undefined }))
    .onBeforeHandle(({ request, principal, set }) => {
      const path = new URL(request.url).pathname;
      if (!options.auth || path === "/health" || path === "/readyz" || path.startsWith(options.authRoutePrefix ?? "/api/auth")) return;
      if (!principal) {
        set.status = 401;
        return { error: "Unauthorized" };
      }
    })
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "Invalid request", details: error.message };
      }
      if (error instanceof AgentRunError) {
        set.status = error.code === "CANCELLED" ? 409 : 500;
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
      if (!run || !belongsToTenant(run, principal)) {
        set.status = 404;
        return { error: "Run not found" };
      }
      return run;
    })
    .get("/sessions/:id", async ({ params, set, principal }) => {
      const session = await runtime.getSession(params.id);
      if (!session || !belongsToTenant(session, principal)) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return session;
    })
    .post(
      "/workflows/:name/run",
      async ({ params, body, principal }) => {
        const run = await runtime.runWorkflow(params.name, body.input, { tenantId: principal?.tenantId });
        return { workflowRunId: run.id, status: run.status, output: run.output, pendingApproval: run.pendingApproval };
      },
      { body: t.Object({ input: t.Optional(t.Unknown()) }) },
    )
    .get("/workflow-runs/:id", async ({ params, set, principal }) => {
      const run = await runtime.getWorkflowRun(params.id);
      if (!run || !belongsToTenant(run, principal)) {
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
        const record = await provider.store({ content: body.content, namespace: body.namespace, metadata: body.metadata, tenantId: principal!.tenantId, expiresAt });
        set.status = 201;
        return record;
      },
      { body: t.Object({ content: t.String({ minLength: 1, maxLength: 32_000 }), expiresAt: t.String(), namespace: t.Optional(t.String()), metadata: t.Optional(t.Record(t.String(), t.Unknown())) }) },
    )
    .get("/memories", async ({ query, principal, set }) => {
      if (!can(principal, "memory:read")) { set.status = 403; return { error: "Forbidden" }; }
      const provider = runtime.getMemoryProvider();
      if (!provider?.list) { set.status = 404; return { error: "Memory listing is not configured" }; }
      return provider.list({ tenantId: principal!.tenantId, namespace: query.namespace, cursor: query.cursor, limit: query.limit ? Number(query.limit) : undefined });
    }, { query: t.Object({ namespace: t.Optional(t.String()), cursor: t.Optional(t.String()), limit: t.Optional(t.String()) }) })
    .delete("/memories/:id", async ({ params, principal, set }) => {
      if (!can(principal, "memory:delete")) { set.status = 403; return { error: "Forbidden" }; }
      const removed = await runtime.getMemoryProvider()?.delete?.(params.id, principal!.tenantId);
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
        });
        return {
          output: result.output,
          runId: result.run.id,
          sessionId: result.run.sessionId,
          status: result.run.status,
          pendingApproval: result.run.pendingApproval,
        };
      },
      {
        body: t.Object({
          input: t.String({ minLength: 1, maxLength: 32_000 }),
          sessionId: t.Optional(t.String()),
        }),
      },
    );
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

export async function createDefaultApp(options: AppOptions = {}) {
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
    ready: async () => {
      await storage.health?.();
      await memoryProvider?.health();
    },
  })).onStop(async () => {
    await runtime.shutdown?.();
  });
}
