import { expect, test } from "bun:test";
import { createDefaultApp } from "./app";

const liveTest = process.env.RUN_LIVE_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY)
  ? test
  : test.skip;

liveTest(
  "serves a real OpenAI response through the Elysia /run route",
  async () => {
    const app = await createDefaultApp();
    const response = await app.handle(
      new Request("http://localhost/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: "Reply with the exact phrase elysia-ok and nothing else." }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.output.toLowerCase()).toContain("elysia-ok");
    expect(body.runId).toEqual(expect.any(String));
  },
  30_000,
);
