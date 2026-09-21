import { resolveConfig } from "./config";
import { bootstrap } from "./bootstrap";
import type { Run } from "../run";
import { InMemoryRunStore } from "../run";
import { AgentRunError } from "../agent";
import { appendMessage, appendRun, createSession, InMemorySessionStore } from "../session";
import type { Session } from "../session";
import type { RuntimeConfig, RuntimeHandle } from "./types";

export type { RuntimeConfig, RuntimeHandle } from "./types";

export async function createRuntime(config: RuntimeConfig = {}): Promise<RuntimeHandle> {
  const resolved = resolveConfig(config);
  const { agents, events } = await bootstrap(resolved);
  const runs = new Map<string, Run>();
  const runStore = config.runStore ?? new InMemoryRunStore();
  const sessionStore = config.sessionStore ?? new InMemorySessionStore();

  return {
    async run(agentName, input, options) {
      const agent = agents.get(agentName);
      if (!agent) throw new Error(`Unknown agent: ${agentName}`);
      let session: Session;
      if (options?.sessionId) {
        session = (await sessionStore.get(options.sessionId)) ?? { ...createSession(), id: options.sessionId };
      } else {
        session = createSession();
      }
      const runOptions = { ...options, sessionId: session.id, history: session.history };
      session = appendMessage(session, { role: "user", content: input });
      try {
        const result = await agent.run(input, runOptions);
        runs.set(result.run.id, result.run);
        await runStore.save(result.run);
        session = appendMessage(session, { role: "assistant", content: result.output });
        session = appendRun(session, result.run);
        await sessionStore.save(session);
        return result;
      } catch (error) {
        if (error instanceof AgentRunError) {
          runs.set(error.run.id, error.run);
          await runStore.save(error.run);
          await sessionStore.save(appendRun(session, error.run));
        }
        throw error;
      }
    },
    getRun: (runId) => runs.get(runId),
    getStoredRun: (runId) => runStore.get(runId),
    getSession: (sessionId) => sessionStore.get(sessionId),
    on: (event, handler) => events.on(event, handler),
    registerAgent: (agent) => agents.register(agent),
  };
}
