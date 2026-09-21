import { resolveConfig } from "./config";
import { bootstrap } from "./bootstrap";
import type { AgentRunResult } from "../agent";
import { AgentRunError } from "../agent";
import { appendEvent, cancelRun, createRun, failRun, type Run } from "../run";
import { InMemoryRunStore } from "../run";
import { upsertRun, appendMessage, appendRun, createSession, InMemorySessionStore } from "../session";
import type { Session } from "../session";
import type { RuntimeConfig, RuntimeHandle } from "./types";

export type { RuntimeConfig, RuntimeHandle } from "./types";

interface ActiveRun {
  controller: AbortController;
  promise: Promise<AgentRunResult>;
}

export async function createRuntime(config: RuntimeConfig = {}): Promise<RuntimeHandle> {
  const resolved = resolveConfig(config);
  const { agents, events } = await bootstrap(resolved);
  const runs = new Map<string, Run>();
  const activeRuns = new Map<string, ActiveRun>();
  const runStore = config.runStore ?? new InMemoryRunStore();
  const sessionStore = config.sessionStore ?? new InMemorySessionStore();
  const sessionLocks = new Map<string, Promise<void>>();

  async function withSessionLock<Result>(sessionId: string, operation: () => Promise<Result>): Promise<Result> {
    const previous = sessionLocks.get(sessionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    sessionLocks.set(sessionId, current);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (sessionLocks.get(sessionId) === current) sessionLocks.delete(sessionId);
    }
  }

  async function saveRunForSession(session: Session, run: Run, appendAssistant?: string): Promise<void> {
    runs.set(run.id, run);
    await runStore.save(run);
    let nextSession = upsertRun(session, run);
    if (appendAssistant !== undefined) {
      nextSession = appendMessage(nextSession, { role: "assistant", content: appendAssistant });
    }
    await sessionStore.save(nextSession);
  }

  function controlEvent<Result>(run: Run<Result>, name: "run.cancelled" | "run.failed", payload: unknown): Run<Result> {
    const event = { name, payload, timestamp: Date.now() };
    events.emit(name, payload);
    return appendEvent(run, event);
  }

  async function executeAgent(
    agentName: string,
    input: string,
    session: Session,
    options: Parameters<NonNullable<RuntimeHandle["run"]>>[2] = {},
    existingRun?: Run<string>,
  ): Promise<AgentRunResult> {
    const agent = agents.get(agentName);
    if (!agent) throw new Error(`Unknown agent: ${agentName}`);
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (options.signal?.aborted) controller.abort();

    const seed = existingRun ?? createRun<string>({
      agent: agent.name,
      model: agent.modelId,
      sessionId: session.id,
    });
    const sessionForRun = options.continuation
      ? session
      : appendMessage(session, { role: "user", content: input });
    const promise = agent.run(input, {
      ...options,
      sessionId: session.id,
      history: options.continuation ? options.history : session.history,
      signal: controller.signal,
      eventBus: events,
      initialRun: existingRun ? undefined : seed,
      resumeRun: existingRun,
    });
    activeRuns.set(seed.id, { controller, promise });

    try {
      const result = await promise;
      await saveRunForSession(sessionForRun, result.run, result.output);
      return result;
    } catch (error) {
      if (error instanceof AgentRunError) {
        const run = error.run;
        await saveRunForSession(sessionForRun, run);
        if (error.code === "APPROVAL_REQUIRED") return { output: "", run };
      }
      throw error;
    } finally {
      options.signal?.removeEventListener("abort", abortFromCaller);
      activeRuns.delete(seed.id);
    }
  }

  return {
    async run(agentName, input, options) {
      const sessionId = options?.sessionId ?? createSession().id;
      return withSessionLock(sessionId, async () => {
        const session = options?.sessionId
          ? (await sessionStore.get(sessionId)) ?? { ...createSession(), id: sessionId }
          : { ...createSession(), id: sessionId };
        return executeAgent(agentName, input, session, options);
      });
    },

    steer(sessionId, instruction) {
      const content = instruction.trim();
      if (!content) throw new Error("Steering instruction must not be empty");
      return withSessionLock(sessionId, async () => {
        const session = (await sessionStore.get(sessionId)) ?? { ...createSession(), id: sessionId };
        const steered = appendMessage(session, { role: "system", content });
        await sessionStore.save(steered);
        return steered;
      });
    },

    async approve(runId, approvalId) {
      const storedRun = await runStore.get(runId);
      if (!storedRun) throw new Error("Run not found");
      if (storedRun.status !== "waiting_approval" || storedRun.pendingApproval?.id !== approvalId) {
        throw new Error("Approval is no longer pending");
      }
      if (!storedRun.continuation || !storedRun.agent || !storedRun.sessionId) {
        throw new Error("Run cannot be resumed");
      }
      return withSessionLock(storedRun.sessionId, async () => {
        const session = await sessionStore.get(storedRun.sessionId!);
        if (!session) throw new Error("Session not found");
        return executeAgent(
          storedRun.agent!,
          storedRun.continuation!.input,
          session,
          {
            continuation: storedRun.continuation,
            approvedToolCallId: storedRun.pendingApproval!.toolCallId,
          },
          storedRun as Run<string>,
        );
      });
    },

    async reject(runId, approvalId) {
      const storedRun = await runStore.get(runId);
      if (!storedRun) throw new Error("Run not found");
      if (storedRun.status !== "waiting_approval" || storedRun.pendingApproval?.id !== approvalId) {
        throw new Error("Approval is no longer pending");
      }
      if (!storedRun.sessionId) throw new Error("Run has no session");
      return withSessionLock(storedRun.sessionId, async () => {
        const session = await sessionStore.get(storedRun.sessionId!);
        if (!session) throw new Error("Session not found");
        const run = controlEvent(
          failRun(storedRun, "Tool approval was rejected", "APPROVAL_REJECTED"),
          "run.failed",
          { runId, error: "Tool approval was rejected" },
        );
        await saveRunForSession(session, run);
        return run;
      });
    },

    async cancel(runId) {
      const active = activeRuns.get(runId);
      if (active) {
        active.controller.abort();
        await active.promise.catch(() => undefined);
        return (await runStore.get(runId)) ?? runs.get(runId);
      }
      const storedRun = await runStore.get(runId);
      if (!storedRun) return undefined;
      if (storedRun.status === "completed" || storedRun.status === "failed" || storedRun.status === "cancelled") {
        return storedRun;
      }
      if (!storedRun.sessionId) return storedRun;
      return withSessionLock(storedRun.sessionId, async () => {
        const session = await sessionStore.get(storedRun.sessionId!);
        if (!session) return storedRun;
        const run = controlEvent(cancelRun(storedRun), "run.cancelled", { runId });
        await saveRunForSession(session, run);
        return run;
      });
    },

    getRun: (runId) => runs.get(runId),
    getStoredRun: (runId) => runStore.get(runId),
    getSession: (sessionId) => sessionStore.get(sessionId),
    on: (event, handler) => events.on(event, handler),
    registerAgent: (agent) => agents.register(agent),
  };
}
