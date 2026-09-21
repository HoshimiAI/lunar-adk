import { Elysia, t } from "elysia";
import { AgentRunError, StorageConflictError, createRuntime, defineAgent } from "@lunar/adk";
import type { RuntimeHandle, RuntimeStreamEvent } from "@lunar/adk";
import { createOpenAIModelProvider } from "@lunar/provider-openai";
import { createSqliteStores } from "@lunar/storage-sqlite";
import { createHttpStores } from "@lunar/storage-http";
import { createBunSqlStores, type BunSqlDialect } from "@lunar/storage-bun-sql";
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

export async function createApp(runtime: RuntimeHandle) {
  return new Elysia()
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
    .post(
      "/run/stream",
      ({ body, request, set }) => {
        if (!runtime.supportsStreaming("assistant")) {
          set.status = 501;
          return { error: "Streaming is not supported by the configured model", code: "STREAMING_UNSUPPORTED" };
        }

        const stream = runtime.stream("assistant", body.input, {
          sessionId: body.sessionId,
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
    .get("/runs/:id", async ({ params, set }) => {
      const run = await runtime.getStoredRun(params.id);
      if (!run) {
        set.status = 404;
        return { error: "Run not found" };
      }
      return run;
    })
    .get("/sessions/:id", async ({ params, set }) => {
      const session = await runtime.getSession(params.id);
      if (!session) {
        set.status = 404;
        return { error: "Session not found" };
      }
      return session;
    })
    .post(
      "/workflows/:name/run",
      async ({ params, body }) => {
        const run = await runtime.runWorkflow(params.name, body.input);
        return { workflowRunId: run.id, status: run.status, output: run.output, pendingApproval: run.pendingApproval };
      },
      { body: t.Object({ input: t.Optional(t.Unknown()) }) },
    )
    .get("/workflow-runs/:id", async ({ params, set }) => {
      const run = await runtime.getWorkflowRun(params.id);
      if (!run) {
        set.status = 404;
        return { error: "Workflow run not found" };
      }
      return run;
    })
    .post("/workflow-runs/:id/cancel", async ({ params, set }) => {
      const run = await runtime.cancelWorkflow(params.id);
      if (!run) {
        set.status = 404;
        return { error: "Workflow run not found" };
      }
      return run;
    })
    .post(
      "/workflow-runs/:id/resume",
      async ({ params, body }) => {
        const run = await runtime.resumeWorkflow(params.id, body.approvalId);
        return { workflowRunId: run.id, status: run.status, output: run.output, pendingApproval: run.pendingApproval };
      },
      { body: t.Object({ approvalId: t.Optional(t.String({ minLength: 1 })) }) },
    )
    .post("/runs/:id/cancel", async ({ params, set }) => {
      const run = await runtime.cancel(params.id);
      if (!run) {
        set.status = 404;
        return { error: "Run not found" };
      }
      return run;
    })
    .post(
      "/runs/:id/approve",
      async ({ params, body }) => {
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
      async ({ params, body }) => {
        const run = await runtime.reject(params.id, body.approvalId);
        return run;
      },
      { body: t.Object({ approvalId: t.String({ minLength: 1 }) }) },
    )
    .post(
      "/sessions/:id/steer",
      async ({ params, body, set }) => {
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
      "/run",
      async ({ body }) => {
        const result = await runtime.run("assistant", body.input, {
          sessionId: body.sessionId,
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

export async function createDefaultApp() {
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
    }),
  );

  return (await createApp(runtime)).onStop(async () => {
    await runtime.shutdown?.();
  });
}
