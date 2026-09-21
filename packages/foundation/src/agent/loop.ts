import type { ModelMessage } from "../model";
import { executeTool, type Tool } from "../tool";
import { shapeToolResult } from "../context";
import { createRun, startRun, completeRun, failRun, addUsage, type Run } from "../run";
import { EventBus } from "../event";
import type { AgentConfig, AgentRunResult } from "./types";

export async function runAgentLoop(config: AgentConfig, input: string, bus: EventBus): Promise<AgentRunResult> {
  let run: Run<string> = startRun(createRun<string>());
  bus.emit("agent.started", { agent: config.name, runId: run.id });

  const messages: ModelMessage[] = [{ role: "user", content: input }];
  const tools = new Map((config.tools ?? []).map((tool) => [tool.name, tool] as [string, Tool]));
  const maxRoundtrips = config.maxToolRoundtrips ?? 8;

  for (let i = 0; i < maxRoundtrips; i++) {
    const response = await config.model.call({
      messages,
      system: config.systemPrompt,
      tools: [...tools.values()].map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.schema.toJSONSchema(),
      })),
    });

    run = addUsage(run, { inputTokens: 0, outputTokens: 0 });

    if (response.toolCalls.length === 0) {
      run = completeRun(run, response.text);
      bus.emit("agent.completed", { agent: config.name, runId: run.id });
      return { output: response.text, run };
    }

    messages.push({ role: "assistant", content: response.text });

    for (const toolCall of response.toolCalls) {
      const tool = tools.get(toolCall.name);
      bus.emit("tool.started", { tool: toolCall.name, runId: run.id });
      if (!tool) {
        messages.push({ role: "user", content: `Unknown tool: ${toolCall.name}` });
        continue;
      }
      const result = await executeTool(tool, toolCall.input);
      bus.emit("tool.completed", { tool: toolCall.name, runId: run.id, result });
      messages.push({ role: "user", content: shapeToolResult(result) });
    }
  }

  run = failRun(run, `Agent "${config.name}" exceeded max tool roundtrips`);
  bus.emit("agent.failed", { agent: config.name, runId: run.id });
  throw new Error(run.error);
}
