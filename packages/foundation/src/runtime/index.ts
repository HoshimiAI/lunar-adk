import { resolveConfig } from "./config";
import { bootstrap } from "./bootstrap";
import type { AgentRunResult } from "../agent";
import { AgentRunError } from "../agent";
import { appendEvent, cancelRun, createRun, failRun, type Run } from "../run";
import { InMemoryRunStore } from "../run";
import { upsertRun, appendMessage, appendRun, createSession, InMemorySessionStore } from "../session";
import type { Session } from "../session";
import type { RuntimeConfig, RuntimeHandle, RuntimeStreamEvent, SteeringResult } from "./types";
import { InMemoryWorkflowStore } from "../workflow";
import type { Workflow, WorkflowContext, WorkflowRun } from "../workflow";
import type { RunContinuation } from "../run";
import { WorkflowApprovalRequired } from "../workflow";
import { ObservabilityHub } from "../observability";

export type { RuntimeConfig, RuntimeHandle, SteeringResult } from "./types";
export type { RuntimeStreamEvent } from "./types";

class AsyncQueue<T> implements AsyncIterable<T> {
  private values: T[] = [];
  private waiters: Array<{
    resolve: (result: IteratorResult<T>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private closed = false;

  push(value: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter.resolve({ value, done: false });
    else this.values.push(value);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    while (this.waiters.length) {
      const waiter = this.waiters.shift()!;
      waiter.resolve({ value: undefined as never, done: true });
    }
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.values.length) return { value: this.values.shift()!, done: false };
    if (this.closed) return { value: undefined as never, done: true };
    return new Promise((resolve, reject) => this.waiters.push({ resolve, reject }));
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return this;
  }
}

interface ActiveRun {
  controller: AbortController;
  promise: Promise<AgentRunResult>;
  sessionId: string;
  agentName: string;
  input: string;
  continuation?: RunContinuation;
  onSteered?: (event: { interruptedRunId: string; continuationRunId: string; sessionId: string }) => void;
}

export async function createRuntime(config: RuntimeConfig = {}): Promise<RuntimeHandle> {
  const resolved = resolveConfig(config);
  const { agents, events } = await bootstrap(resolved, config.memory);
  const runs = new Map<string, Run>();
  const activeRuns = new Map<string, ActiveRun>();
  const runStore = config.runStore ?? new InMemoryRunStore();
  const sessionStore = config.sessionStore ?? new InMemorySessionStore();
  const workflowStore = config.workflowStore ?? new InMemoryWorkflowStore();
  const observability = new ObservabilityHub(config.observability);
  events.onAny((event) => observability.recordEvent(event));
  const workflows = new Map<string, Workflow>();
  const activeWorkflows = new Map<string, { controller: AbortController; promise: Promise<WorkflowRun> }>();
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
    observability.recordRun(run);
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
    const abortFromCaller = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });
    if (options.signal?.aborted) controller.abort();

    const seed = existingRun ?? options.initialRun ?? createRun<string>({
      agent: agent.name,
      model: agent.modelId,
      sessionId: session.id,
      parentRunId: options.parentRunId,
    });
    const sessionForRun = options.continuation
      ? session
      : appendMessage(session, { role: "user", content: input });
    const active: ActiveRun = {
      controller,
      promise: undefined as never,
      sessionId: session.id,
      agentName,
      input,
      onSteered: options.onSteered,
    };
    const promise = agent.run(input, {
      ...options,
      sessionId: session.id,
      history: options.continuation ? options.history : session.history,
      signal: controller.signal,
      eventBus: events,
      initialRun: existingRun ? undefined : seed,
      resumeRun: existingRun,
      onInterrupted: (continuation) => {
        active.continuation = continuation;
        options.onInterrupted?.(continuation);
      },
    });
    active.promise = promise;
    activeRuns.set(seed.id, active);

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

  async function saveWorkflow(run: WorkflowRun): Promise<WorkflowRun> {
    await workflowStore.save(run);
    return run;
  }

  async function executeWorkflow(workflow: Workflow, input: unknown, existing?: WorkflowRun, approvedApprovalId?: string): Promise<WorkflowRun> {
    const controller = new AbortController();
    const run: WorkflowRun = existing
      ? {
          ...existing,
          status: "running",
          pendingApproval: undefined,
          approvedApprovalIds: approvedApprovalId
            ? [...new Set([...existing.approvedApprovalIds, approvedApprovalId])]
            : existing.approvedApprovalIds,
          error: undefined,
          endedAt: undefined,
        }
      : {
          id: crypto.randomUUID(),
          workflow: workflow.name,
          version: workflow.version,
          status: "running",
          input,
          state: {},
          checkpoints: [],
          childRunIds: [],
          startedAt: Date.now(),
          approvedApprovalIds: [],
    };
    await saveWorkflow(run);
    events.emit("workflow.started", { workflow: workflow.name, workflowRunId: run.id, resumed: Boolean(existing) });

    const latest = run.checkpoints.at(-1);
    const context: WorkflowContext = {
      input: run.input,
      state: run.state,
      signal: controller.signal,
      run,
      resumeFrom: latest,
      async checkpoint(name, state = context.state) {
        const checkpoint = { name, state: { ...state }, createdAt: Date.now() };
        run.state = { ...checkpoint.state };
        run.checkpoints = [...run.checkpoints, checkpoint];
        await saveWorkflow(run);
        return checkpoint;
      },
      async requestApproval(id, message) {
        if (run.approvedApprovalIds.includes(id)) return;
        const approval = run.pendingApproval?.id === id
          ? run.pendingApproval
          : { id, message, requestedAt: Date.now() };
        run.pendingApproval = approval;
        run.status = "waiting_approval";
        await saveWorkflow(run);
        throw new WorkflowApprovalRequired(approval);
      },
      async runSubAgent(agentRef, agentInput, options = {}) {
        const agent = typeof agentRef === "string" ? agents.get(agentRef) : agentRef;
        if (!agent) throw new Error(`Unknown agent: ${String(agentRef)}`);
        const sessionId = options.sessionId;
        const session = sessionId
          ? (await sessionStore.get(sessionId)) ?? { ...createSession(), id: sessionId }
          : createSession();
        const result = await executeAgent(agent.name, agentInput, session, {
          signal: controller.signal,
          sessionId: session.id,
          parentRunId: run.id,
        });
        run.childRunIds = [...new Set([...run.childRunIds, result.run.id])];
        await saveWorkflow(run);
        return result;
      },
      parallel(tasks) {
        return Promise.all(tasks.map((task) => task()));
      },
    };

    const promise = (async () => {
      try {
        const output = await workflow.run(context);
        run.output = output;
        run.status = "completed";
        run.endedAt = Date.now();
        events.emit("workflow.completed", { workflow: workflow.name, workflowRunId: run.id });
        return await saveWorkflow(run);
      } catch (error) {
        if (error instanceof WorkflowApprovalRequired) return await saveWorkflow(run);
        const message = error instanceof Error ? error.message : String(error);
        run.status = controller.signal.aborted ? "cancelled" : "failed";
        run.error = message;
        run.endedAt = Date.now();
        events.emit("workflow.failed", { workflow: workflow.name, workflowRunId: run.id, error: message });
        return await saveWorkflow(run);
      } finally {
        activeWorkflows.delete(run.id);
      }
    })();
    activeWorkflows.set(run.id, { controller, promise });
    return promise;
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

    supportsStreaming(agentName) {
      return agents.get(agentName)?.supportsStreaming === true;
    },

    async *stream(agentName, input, options): AsyncIterable<RuntimeStreamEvent> {
      const agent = agents.get(agentName);
      if (!agent) throw new Error(`Unknown agent: ${agentName}`);
      if (!agent.supportsStreaming) {
        throw new Error(`Model for agent "${agentName}" does not support streaming`);
      }

      const sessionId = options?.sessionId ?? createSession().id;
      const queue = new AsyncQueue<RuntimeStreamEvent>();
      let steeringNotified = false;
      const operation = withSessionLock(sessionId, async () => {
        const session = options?.sessionId
          ? (await sessionStore.get(sessionId)) ?? { ...createSession(), id: sessionId }
          : { ...createSession(), id: sessionId };
        return executeAgent(agentName, input, session, {
          ...options,
          streaming: true,
          onEvent: (event) => queue.push({ type: "event", event }),
          onTextDelta: (runId, text) => queue.push({ type: "text.delta", runId, text }),
          onSteered: (event) => {
            steeringNotified = true;
            queue.push({ type: "stream.interrupted", ...event });
          },
        });
      });

      void operation
        .then((result) => {
          queue.push({ type: "stream.completed", result });
          queue.close();
        })
        .catch((error) => {
          const runError = error instanceof AgentRunError ? error : undefined;
          if (runError?.code === "STEERED" && steeringNotified) {
            queue.close();
            return;
          }
          queue.push({
            type: "stream.error",
            error: error instanceof Error ? error.message : String(error),
            runId: runError?.run.id,
            code: runError?.code,
          });
          queue.close();
        });

      for await (const event of queue) yield event;
    },

    async steer(sessionId, instruction): Promise<Session | SteeringResult> {
      const content = instruction.trim();
      if (!content) throw new Error("Steering instruction must not be empty");

      const activeEntry = [...activeRuns.entries()].find(([, active]) => active.sessionId === sessionId);
      if (activeEntry) {
        const [interruptedRunId, active] = activeEntry;
        const activeAgent = agents.get(active.agentName);
        if (!activeAgent) throw new Error(`Unknown agent: ${active.agentName}`);
        const continuationSeed = createRun<string>({
          agent: activeAgent.name,
          model: activeAgent.modelId,
          sessionId,
          parentRunId: interruptedRunId,
        });
        const continuationRunId = continuationSeed.id;
        active.onSteered?.({ sessionId, interruptedRunId, continuationRunId });
        void (async () => {
          active.controller.abort("steered");
          await active.promise.catch(() => undefined);
          await withSessionLock(sessionId, async () => {
            const session = (await sessionStore.get(sessionId)) ?? { ...createSession(), id: sessionId };
            const interrupted = await runStore.get(interruptedRunId);
            const steered = appendMessage(session, { role: "system", content });
            await sessionStore.save(steered);
            const captured = active.continuation ?? {
              input: active.input,
              messages: session.history,
              round: 0,
              toolCalls: [],
              nextToolIndex: 0,
            };
            const continuation: RunContinuation = {
              ...captured,
              input: active.input,
              messages: [...captured.messages, { role: "system", content }],
            };
            await executeAgent(active.agentName, active.input, steered, {
              sessionId,
              continuation,
              initialRun: continuationSeed,
              parentRunId: interrupted?.id ?? interruptedRunId,
            });
          });
        })().catch(() => undefined);
        return { status: "accepted", sessionId, interruptedRunId, continuationRunId };
      }

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
    shutdown: () => observability.shutdown(),
    registerAgent: (agent) => agents.register(agent),
    registerWorkflow: (workflow) => workflows.set(workflow.name, workflow),
    runWorkflow(name, input) {
      const workflow = workflows.get(name);
      if (!workflow) return Promise.reject(new Error(`Unknown workflow: ${name}`));
      return executeWorkflow(workflow, input);
    },
    getWorkflowRun: (id) => workflowStore.get(id),
    async resumeWorkflow(id, approvalId) {
      const stored = await workflowStore.get(id);
      if (!stored) throw new Error("Workflow run not found");
      if (["completed", "cancelled"].includes(stored.status)) throw new Error("Workflow cannot be resumed");
      if (stored.status === "waiting_approval") {
        if (!stored.pendingApproval || stored.pendingApproval.id !== approvalId) throw new Error("Approval is no longer pending");
      }
      const workflow = workflows.get(stored.workflow);
      if (!workflow) throw new Error(`Unknown workflow: ${stored.workflow}`);
      return executeWorkflow(workflow, stored.input, stored, stored.status === "waiting_approval" ? approvalId : undefined);
    },
    async cancelWorkflow(id) {
      const active = activeWorkflows.get(id);
      if (active) {
        active.controller.abort();
        return active.promise;
      }
      const stored = await workflowStore.get(id);
      if (!stored) return undefined;
      if (["completed", "failed", "cancelled"].includes(stored.status)) return stored;
      const cancelled = { ...stored, status: "cancelled" as const, error: "The operation was aborted", endedAt: Date.now() };
      return saveWorkflow(cancelled);
    },
  };
}
