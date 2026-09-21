import { expect, test } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";
import { createDefaultApp } from "./app";

const liveTest = process.env.RUN_LIVE_TESTS === "1" && Boolean(process.env.OPENAI_API_KEY)
  ? test
  : test.skip;

liveTest(
  "serves production OpenAI requests with persisted sessions",
  async () => {
    const sqlitePath = `${process.env.TMPDIR ?? "/tmp"}/lunar-elysia-${crypto.randomUUID()}.db`;
    const previousSqlitePath = process.env.SQLITE_PATH;
    process.env.SQLITE_PATH = sqlitePath;
    let app: Awaited<ReturnType<typeof createDefaultApp>> | undefined;

    try {
      app = await createDefaultApp();
      const firstResponse = await app.handle(
        new Request("http://localhost/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ input: "Reply with the exact phrase elysia-ok and nothing else." }),
        }),
      );
      const first = await firstResponse.json();

      expect(firstResponse.status).toBe(200);
      expect(first.output.toLowerCase()).toContain("elysia-ok");
      expect(first.runId).toEqual(expect.any(String));
      expect(first.sessionId).toEqual(expect.any(String));

      const secondResponse = await app.handle(
        new Request("http://localhost/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            input: "Reply with the exact phrase elysia-follow-up and nothing else.",
            sessionId: first.sessionId,
          }),
        }),
      );
      const second = await secondResponse.json();
      const storedResponse = await app.handle(new Request(`http://localhost/runs/${first.runId}`));
      const stored = await storedResponse.json();

      expect(secondResponse.status).toBe(200);
      expect(second.output.toLowerCase()).toContain("elysia-follow-up");
      expect(second.sessionId).toBe(first.sessionId);
      expect(storedResponse.status).toBe(200);
      expect(stored.status).toBe("completed");
      expect(stored.sessionId).toBe(first.sessionId);
    } finally {
      if (app?.server) await app.stop();
      if (previousSqlitePath === undefined) delete process.env.SQLITE_PATH;
      else process.env.SQLITE_PATH = previousSqlitePath;
      if (existsSync(sqlitePath)) unlinkSync(sqlitePath);
    }
  },
  30_000,
);
