import { defineTool, defineWorkflow, type AuthProvider } from "@lunar/adk";
import { createDefaultApp } from "./app";

const token = process.env.LIVE_TEST_BEARER_TOKEN;
if (!token) throw new Error("LIVE_TEST_BEARER_TOKEN is required for this local live-test server");

const tenantId = process.env.PLANET_TENANT_ID ?? "lunar-local";
const auth: AuthProvider = {
  async authenticate(request) {
    if (request.headers.get("authorization") !== `Bearer ${token}`) return undefined;
    return { subjectId: "curl-live-test", tenantId, permissions: ["*"] };
  },
};

const approvalTool = defineTool<{ message: string }, string>({
  name: "request_live_approval",
  description: "Use this to request approval before sending a message. Call it whenever the user asks for live approval testing.",
  schema: {
    parse(input) {
      if (!input || typeof input !== "object" || typeof (input as { message?: unknown }).message !== "string") {
        throw new Error("Expected a message string");
      }
      return { message: (input as { message: string }).message };
    },
    toJSONSchema: () => ({
      type: "object",
      properties: { message: { type: "string" } },
      required: ["message"],
      additionalProperties: false,
    }),
  },
  permission: { requiresApproval: true },
  execute: ({ message }) => `Approved message: ${message}`,
});

const waitTool = defineTool<Record<string, never>, string>({
  name: "wait_live_task",
  description: "For live interruption testing, call once when asked to hold a response open. It waits 35 seconds.",
  schema: {
    parse: () => ({}),
    toJSONSchema: () => ({ type: "object", properties: {}, additionalProperties: false }),
  },
  execute: async () => {
    await new Promise((resolve) => setTimeout(resolve, 35_000));
    return "Wait completed.";
  },
});

const app = await createDefaultApp({
  auth,
  agentTools: [approvalTool, waitTool],
  configureRuntime(runtime) {
    runtime.registerWorkflow(defineWorkflow({
      name: "research",
      async run(context) {
        const topic = (context.input as { topic?: string } | undefined)?.topic ?? "unknown";
        await context.checkpoint("draft-ready", { topic });
        await context.requestApproval("publish", "Approve publishing this research result.");
        return { topic, status: "published" };
      },
    }));
  },
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port);
console.log(`Lunar Unknown Planet live-test server running at localhost:${port}`);
