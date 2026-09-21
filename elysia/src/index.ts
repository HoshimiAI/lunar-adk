import { Elysia, t } from "elysia";
import { createRuntime, defineAgent } from "@lunar/foundation";
import type { ModelProvider } from "@lunar/foundation/model";

const echoModel: ModelProvider = {
  id: "echo",
  capabilities: {},
  async call({ messages }) {
    return {
      text: `Echo: ${messages.at(-1)?.content ?? ""}`,
      toolCalls: [],
    };
  },
};

const runtime = await createRuntime();
runtime.registerAgent(
  defineAgent({
    name: "assistant",
    model: echoModel,
    systemPrompt: "You are a helpful assistant.",
  }),
);

const app = new Elysia()
  .get("/", () => ({ name: "lunar-elysia", status: "ok" }))
  .post(
    "/run",
    async ({ body }) => {
      const result = await runtime.run("assistant", body.input);
      return {
        output: result.output,
        runId: result.run.id,
      };
    },
    {
      body: t.Object({ input: t.String() }),
    },
  )
  .listen(process.env.PORT ? Number(process.env.PORT) : 3000);

console.log(`Lunar Elysia server running at ${app.server?.hostname}:${app.server?.port}`);
