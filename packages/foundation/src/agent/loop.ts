import type { ModelMessage } from "../model";
import { executeTool, type Tool } from "../tool";
import { buildContext, shapeToolResult } from "../context";
import { appendEvent, createRun, startRun, completeRun, failRun, addUsage, type Run } from "../run";
import { EventBus, type EventName } from "../event";
import { withRetry } from "./retry";
import { AgentRunError } from "./errors";
import { throwIfAborted } from "./cancellation";
import type { AgentConfig, AgentRunOptions, AgentRunResult } from "./types";

export async function runAgentLoop(
  config: AgentConfig,
  input: string,
  bus: EventBus,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  let run: Run<string> = startRun(createRun<string>({
    agent: config.name,
    model: config.model.id,
    sessionId: options.sessionId,
  }));
  const record = (name: EventName, payload: unknown) => {
    const event = { name, payload, timestamp: Date.now() };
    run = appendEvent(run, event);
    bus.emit(name, payload);
  };

  record("run.started", { agent: config.name, runId: run.id });
  record("agent.started", { agent: config.name, runId: run.id });

  try {
    const messages: ModelMessage[] = [
      ...(options.history ?? []),
      { role: "user", content: input },
    ];
    const tools = new Map((config.tools ?? []).map((tool) => [tool.name, tool] as [string, Tool]));
    const maxRoundtrips = config.maxToolRoundtrips ?? 8;

    for (let i = 0; i < maxRoundtrips; i++) {
      throwIfAborted(options.signal);
      const context = config.maxContextTokens
        ? buildContext(messages, { maxTokens: config.maxContextTokens })
        : { messages, estimatedTokens: 0 };
      const response = await withRetry(
        () => config.model.call({
          messages: context.messages,
          system: config.systemPrompt,
          tools: [...tools.values()].map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.schema.toJSONSchema(),
          })),
          signal: options.signal,
        }),
        config.retryPolicy ?? { maxAttempts: 1, backoffMs: () => 0 },
        options.signal,
      );

      run = addUsage(run, response.usage ?? { inputTokens: 0, outputTokens: 0 });
      record("model.called", { agent: config.name, runId: run.id, round: i });

      if (response.toolCalls.length === 0) {
        run = completeRun(run, response.text);
        record("agent.completed", { agent: config.name, runId: run.id });
        record("run.completed", { agent: config.name, runId: run.id });
        return { output: response.text, run };
      }

      messages.push({ role: "assistant", content: response.text });

      for (const toolCall of response.toolCalls) {
        throwIfAborted(options.signal);
        const tool = tools.get(toolCall.name);
        record("tool.started", { tool: toolCall.name, runId: run.id });
        if (!tool) {
          const message = `Unknown tool: ${toolCall.name}`;
          record("tool.failed", { tool: toolCall.name, runId: run.id, error: message });
          messages.push({ role: "user", content: message });
          continue;
        }
        const result = await executeTool(tool, toolCall.input);
        record(result.error ? "tool.failed" : "tool.completed", {
          tool: tool.name,
          runId: run.id,
          result,
        });
        messages.push({ role: "user", content: shapeToolResult(result) });
      }
    }

    throw new Error(`Agent "${config.name}" exceeded max tool roundtrips`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run = failRun(run, message);
    record("agent.failed", { agent: config.name, runId: run.id, error: message });
    record("run.failed", { agent: config.name, runId: run.id, error: message });
    throw new AgentRunError(message, run, { cause: error });
  }
}
