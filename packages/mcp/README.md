# @lunar/mcp

MCP tools for queueing messages and steering sessions managed by a Lunar
\`RuntimeHandle\`.

\`\`\`ts
import { createLunarMcpServer } from "@lunar/mcp";
import { StdioServerTransport } from "@modelcontextprotocol/server/stdio";

const server = createLunarMcpServer(runtime, {
  authorizeSession: async ({ sessionId }) => {
    const [session, activeRun] = await Promise.all([
      runtime.getSession(sessionId),
      Promise.resolve(runtime.getActiveRunForSession(sessionId)),
    ]);
    const owner = session ?? activeRun;
    return owner?.tenantId === tenantId && owner.ownerId === userId;
  },
});

await server.connect(new StdioServerTransport());
\`\`\`

The required \`authorizeSession\` callback must verify the caller's access for
both operations. For a local, single-user stdio server, it can use the trusted
local identity. For a shared server, bind the callback to the authenticated MCP
caller and check session ownership.

The server registers two tools:

- \`queue_message({ sessionId, message })\` adds a user turn after existing work
  in that session and returns when the turn completes.
- \`steer_session({ sessionId, instruction })\` interrupts the active turn and
  continues it with the instruction.

The host chooses the MCP transport. Use stdio for a local process or the SDK's
Streamable HTTP handler for a remote server. Queue order follows Lunar's
in-process session lock and is not shared between runtime instances.
