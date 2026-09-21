import type { ModelMessage, ModelResponse, ModelToolCall } from "../model";
import { executeTool, needsApproval, type Tool } from "../tool";
import { buildContext, shapeToolResult } from "../context";
import {
  appendEvent,
  cancelRun,
  createRun,
  completeRun,
  failRun,
  pauseRun,
  startRun,
  addUsage,
  type Run,
} from "../run";
import { EventBus, type EventName } from "../event";
import { withRetry } from "./retry";
import { AgentRunError } from "./errors";
import { throwIfAborted } from "./cancellation";
import type { AgentConfig, AgentRunOptions, AgentRunResult } from "./types";

export async function runAgentLoop(
  config: AgentConfig,
  input: string,
  fallbackBus: EventBus,
  options: AgentRunOptions = {},
): Promise<AgentRunResult> {
  let run: Run<string> = startRun(options.resumeRun ?? options.initialRun ?? createRun<string>({
    agent: config.name,
    model: config.model.id,
    sessionId: options.sessionId,
    parentRunId: options.parentRunId,
  }));
  const bus = options.eventBus ?? fallbackBus;
  const record = (name: EventName, payload: unknown) => {
    const event = { name, payload, timestamp: Date.now() };
    run = appendEvent(run, event);
    bus.emit(name, payload);
    options.onEvent?.(event);
  };

  if (!options.resumeRun) {
    record("run.started", { agent: config.name, runId: run.id });
    record("agent.started", { agent: config.name, runId: run.id });
  } else {
    record("agent.started", { agent: config.name, runId: run.id, resumed: true });
  }

  const continuation = options.continuation;
  let messages: ModelMessage[] = continuation
      ? [...continuation.messages]
      : [...(options.history ?? []), { role: "user", content: input }];
  const tools = new Map((config.tools ?? []).map((tool) => [tool.name, tool] as [string, Tool]));
  const maxRoundtrips = config.maxToolRoundtrips ?? 8;
  let round = continuation?.round ?? 0;
  let toolCalls: ModelToolCall[] | undefined = continuation?.toolCalls;
  let nextToolIndex = continuation?.nextToolIndex ?? 0;
  let approvedToolCallId = options.approvedToolCallId;
  let interruptionCaptured = false;
  const captureInterruption = () => {
    if (interruptionCaptured || options.signal?.reason !== "steered") return;
    interruptionCaptured = true;
    options.onInterrupted?.({
      input,
      messages: [...messages],
      round,
      toolCalls: toolCalls ?? [],
      nextToolIndex,
    });
  };

  try {
    while (true) {
      captureInterruption();
      throwIfAborted(options.signal);

      if (!toolCalls || nextToolIndex >= toolCalls.length) {
        if (toolCalls) {
          round++;
          toolCalls = undefined;
          nextToolIndex = 0;
        }
        if (round >= maxRoundtrips) {
          throw new Error(`Agent "${config.name}" exceeded max tool roundtrips`);
        }

        const context = config.maxContextTokens
          ? buildContext(messages, { maxTokens: config.maxContextTokens })
          : { messages, estimatedTokens: 0 };
        const modelOptions = {
            messages: context.messages,
            system: config.systemPrompt,
            tools: config.model.capabilities.tools === false
              ? undefined
              : [...tools.values()].map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  inputSchema: tool.schema.toJSONSchema(),
                })),
            signal: options.signal,
          };
        let response: ModelResponse;
        if (options.streaming) {
          if (config.model.capabilities.streaming !== true || !config.model.stream) {
            throw new Error(`Model "${config.model.id}" does not support streaming`);
          }
          let streamedResponse: ModelResponse | undefined;
          for await (const part of config.model.stream(modelOptions)) {
            if (part.type === "text-delta") {
              options.onTextDelta?.(run.id, part.text);
            } else {
              streamedResponse = part.response;
            }
          }
          if (!streamedResponse) throw new Error("Streaming model ended without a response");
          response = streamedResponse;
        } else {
          response = await withRetry(
            () => config.model.call(modelOptions),
            config.retryPolicy ?? { maxAttempts: 1, backoffMs: () => 0 },
            options.signal,
          );
        }

        run = addUsage(run, response.usage ?? { inputTokens: 0, outputTokens: 0 });
        record("model.called", { agent: config.name, runId: run.id, round });

        if (response.toolCalls.length === 0) {
          run = completeRun(run, response.text);
          record("agent.completed", { agent: config.name, runId: run.id });
          record("run.completed", { agent: config.name, runId: run.id });
          return { output: response.text, run };
        }

        messages.push({ role: "assistant", content: response.text, toolCalls: response.toolCalls });
        toolCalls = response.toolCalls;
        nextToolIndex = 0;
      }

      const toolCall = toolCalls[nextToolIndex];
      if (!toolCall) continue;
      throwIfAborted(options.signal);
      const tool = tools.get(toolCall.name);
      record("tool.started", { tool: toolCall.name, runId: run.id, toolCallId: toolCall.id });

      if (tool && needsApproval(tool) && approvedToolCallId !== toolCall.id) {
        const approval = {
          id: crypto.randomUUID(),
          toolCallId: toolCall.id,
          toolName: tool.name,
          input: toolCall.input,
          requestedAt: Date.now(),
        };
        run = pauseRun(run, approval, {
          input,
          messages,
          round,
          toolCalls,
          nextToolIndex,
        });
        record("tool.approval_required", { tool: tool.name, runId: run.id, approvalId: approval.id });
        throw new AgentRunError(
          `Tool "${tool.name}" requires approval before execution`,
          run,
          "APPROVAL_REQUIRED",
        );
      }

      const result = !tool
        ? { toolName: toolCall.name, error: `Unknown tool: ${toolCall.name}` }
        : await executeTool(tool, toolCall.input, { approved: approvedToolCallId === toolCall.id });
      record(result.error ? "tool.failed" : "tool.completed", {
        tool: toolCall.name,
        runId: run.id,
        toolCallId: toolCall.id,
        result,
      });
      messages.push({
        role: "tool",
        toolCallId: toolCall.id,
        toolName: toolCall.name,
        content: !tool ? result.error! : shapeToolResult(result),
      });
      nextToolIndex++;
      approvedToolCallId = undefined;
    }
  } catch (error) {
    if (error instanceof AgentRunError) throw error;

    const message = error instanceof Error ? error.message : String(error);
    const cancelled = error instanceof DOMException && error.name === "AbortError";
    const code = cancelled && options.signal?.reason === "steered"
      ? "STEERED"
      : cancelled
        ? "CANCELLED"
      : message.includes("exceeded max tool roundtrips")
        ? "MAX_TOOL_ROUNDS"
        : "EXECUTION_FAILED";
    captureInterruption();
    run = cancelled ? cancelRun(run, message) : failRun(run, message, code);
    if (code === "STEERED") run = { ...run, errorCode: code };
    record(cancelled ? "run.cancelled" : "agent.failed", { agent: config.name, runId: run.id, error: message });
    if (!cancelled) record("run.failed", { agent: config.name, runId: run.id, error: message });
    throw new AgentRunError(message, run, code, { cause: error });
  }

  throw new Error("Agent loop exited unexpectedly");
}
