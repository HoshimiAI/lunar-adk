import { expect, test } from "bun:test";
import { createRuntime, defineAgent } from "@lunar/adk";
import { createOpenAIModelProvider } from "./index";

const liveTest = process.env.RUN_LIVE_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY)
  ? test
  : test.skip;

liveTest(
  "runs a real OpenAI request through the ADK runtime",
  async () => {
    const model = createOpenAIModelProvider({
      model: process.env.OPENAI_TEST_MODEL ?? "gpt-5-mini",
    });
    const runtime = await createRuntime();
    runtime.registerAgent(
      defineAgent({
        name: "openai-assistant",
        model,
        maxToolRoundtrips: 1,
      }),
    );

    const result = await runtime.run(
      "openai-assistant",
      "Reply with the exact phrase integration-ok and nothing else.",
    );

    expect(result.run.status).toBe("completed");
    expect(result.output.toLowerCase()).toContain("integration-ok");
    expect(result.run.usage.inputTokens + result.run.usage.outputTokens).toBeGreaterThan(0);
  },
  30_000,
);
