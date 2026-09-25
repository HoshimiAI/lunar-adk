import { McpServer } from "@modelcontextprotocol/server";
import * as z from "zod/v4";
import type { RuntimeHandle } from "@lunar/foundation";

export type LunarMcpOperation = "queue_message" | "steer_session";

export interface LunarMcpServerOptions {
  /** Agent that receives queued messages. Defaults to the Elysia app's "assistant" agent. */
  agentName?: string;
  /** Check the caller's access to a session before queueing a message or steering it. */
  authorizeSession: (input: { sessionId: string; operation: LunarMcpOperation }) => boolean | Promise<boolean>;
  name?: string;
  version?: string;
}

function toolError(text: string) {
  return { content: [{ type: "text" as const, text }], isError: true };
}

function toolResult(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value) }] };
}

/** Creates an MCP server exposing session queue and steering tools. */
export function createLunarMcpServer(runtime: RuntimeHandle, options: LunarMcpServerOptions): McpServer {
  const server = new McpServer({
    name: options.name ?? "lunar-adk",
    version: options.version ?? "1.0.0",
  });
  const agentName = options.agentName ?? "assistant";

  server.registerTool(
    "queue_message",
    {
      description: "Queue a user message as the next turn in a session. The active turn finishes first; this call returns when the queued turn completes.",
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        sessionId: z.string().min(1).describe("Session that should receive the next user turn"),
        message: z.string().min(1).max(32_000).describe("User message to run after the current turn"),
      }),
    },
    async ({ sessionId, message }) => {
      try {
        if (!(await options.authorizeSession({ sessionId, operation: "queue_message" }))) {
          return toolError("Session not found or access denied");
        }
        const result = await runtime.run(agentName, message, { sessionId });
        return toolResult({
          output: result.output,
          runId: result.run.id,
          sessionId: result.run.sessionId,
          status: result.run.status,
          pendingApproval: result.run.pendingApproval,
          usage: result.run.usage,
        });
      } catch {
        return toolError("Queued message failed");
      }
    },
  );

  server.registerTool(
    "steer_session",
    {
      description: "Interrupt an active session turn and continue it with the supplied instruction.",
      annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: true },
      inputSchema: z.object({
        sessionId: z.string().min(1).describe("Session to steer"),
        instruction: z.string().min(1).max(4_000).describe("Instruction to apply to the active or next turn"),
      }),
    },
    async ({ sessionId, instruction }) => {
      try {
        if (!(await options.authorizeSession({ sessionId, operation: "steer_session" }))) {
          return toolError("Session not found or access denied");
        }
        const result = await runtime.steer(sessionId, instruction);
        if ("status" in result) return toolResult(result);
        return toolResult({ sessionId: result.id, steered: true });
      } catch {
        return toolError("Session steering failed");
      }
    },
  );

  return server;
}
