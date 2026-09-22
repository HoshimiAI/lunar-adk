import { definePlugin, defineTool, defineWorkflow } from "@lunar/adk";

interface GreetInput {
  name: string;
}

const greetSchema = {
  parse(input: unknown): GreetInput {
    if (!input || typeof input !== "object" || typeof (input as { name?: unknown }).name !== "string") {
      throw new Error("Expected an object with a name string");
    }
    const name = (input as { name: string }).name.trim();
    if (!name || name.length > 100) throw new Error("Name must contain 1 to 100 characters");
    return { name };
  },
  toJSONSchema: () => ({
    type: "object",
    properties: { name: { type: "string" } },
    required: ["name"],
    additionalProperties: false,
  }),
};

export const greetingPlugin = definePlugin({
  id: "example-greeting",
  version: "1.0.0",
  description: "A sample bundle of greeting tools and workflows.",
  register(context) {
    context.tools.register(defineTool<GreetInput, { message: string }>({
      name: "greet",
      description: "Create a friendly greeting.",
      schema: greetSchema,
      execute: ({ name }) => ({ message: `Hello, ${name}!` }),
    }));
    context.workflows.register(defineWorkflow({
      name: "greet",
      version: "1.0.0",
      async run(workflow) {
        const { name } = greetSchema.parse(workflow.input);
        return { message: `Hello, ${name}!` };
      },
    }));
  },
});
