import { defineAgent } from "../../src/agent";
import type { ModelProvider } from "../../src/model";

const echoModel: ModelProvider = {
  id: "echo",
  capabilities: {},
  call: async ({ messages }) => ({
    text: `echo: ${messages.at(-1)?.content ?? ""}`,
    toolCalls: [],
  }),
};

const agent = defineAgent({ name: "basic-agent", model: echoModel });

const result = await agent.run("hello lunar");
console.log(result.output);
