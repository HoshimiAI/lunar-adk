import { Elysia, t } from "elysia";
import { AgentRunError, createRuntime, defineAgent } from "@lunar/adk";
import type { RuntimeHandle } from "@lunar/adk";
import { createOpenAIModelProvider } from "@lunar/provider-openai";

export async function createApp(runtime: RuntimeHandle) {
  return new Elysia()
    .onError(({ code, error, set }) => {
      if (code === "VALIDATION") {
        set.status = 422;
        return { error: "Invalid request", details: error.message };
      }
      if (error instanceof AgentRunError) {
        set.status = 500;
        return { error: error.message, runId: error.run.id };
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
        };
      },
      {
        body: t.Object({
          input: t.String(),
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

  const runtime = await createRuntime();
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

  return createApp(runtime);
}
