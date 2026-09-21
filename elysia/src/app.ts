import { Elysia, t } from "elysia";
import { AgentRunError, createRuntime, defineAgent } from "@lunar/adk";
import type { RuntimeHandle } from "@lunar/adk";
import { createOpenAIModelProvider } from "@lunar/provider-openai";
import { createSqliteStores } from "@lunar/storage-sqlite";

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
      if (error instanceof Error && (error.message === "Run not found" || error.message === "Session not found")) {
        set.status = 404;
        return { error: error.message };
      }
      if (error instanceof Error && error.message === "Approval is no longer pending") {
        set.status = 409;
        return { error: error.message };
      }
    })
    .get("/", () => ({ name: "lunar-elysia", status: "ok" }))
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
      async ({ params, body }) => {
        const session = await runtime.steer(params.id, body.instruction);
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

  const storage = createSqliteStores(process.env.SQLITE_PATH ?? "lunar.db");
  const runtime = await createRuntime({
    runStore: storage.runStore,
    sessionStore: storage.sessionStore,
  });
  runtime.registerAgent(
    defineAgent({
      name: "assistant",
      model: createOpenAIModelProvider({
        model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
        apiKey,
      }),
      systemPrompt: "You are a helpful assistant.",
    }),
  );

  return (await createApp(runtime)).onStop(() => storage.close());
}
