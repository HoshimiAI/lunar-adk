import { definePlugin } from "../../src/plugin";
import { defineTool } from "../../src/tool";
import type { SchemaLike } from "../../src/types";

interface AddNoteInput {
  text: string;
}

const addNoteSchema: SchemaLike<AddNoteInput> = {
  parse: (input) => input as AddNoteInput,
  toJSONSchema: () => ({
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  }),
};

const addNote = defineTool({
  name: "add_note",
  description: "Store a short text note",
  schema: addNoteSchema,
  execute: ({ text }) => ({ id: crypto.randomUUID(), text }),
});

export const notesPlugin = definePlugin({
  id: "example-notes",
  version: "0.1.0",
  register(ctx) {
    ctx.tools.register(addNote);
    ctx.events.on("tool.completed", (event) => {
      console.log("tool completed:", event.payload);
    });
  },
});
