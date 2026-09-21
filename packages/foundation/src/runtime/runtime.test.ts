import { expect, test } from "bun:test";
import { createRuntime, definePlugin } from "../index";
import { createInMemoryProvider, type MemoryProvider } from "../memory";

test("registers the configured memory provider for plugins", async () => {
  const provider = createInMemoryProvider("custom-memory");
  let registered: MemoryProvider | undefined;

  await createRuntime({
    memory: provider,
    plugins: [{
      id: "memory-plugin",
      version: "1.0.0",
      register(context) {
        registered = context.memory.get("custom-memory");
      },
    }],
  });

  expect(registered).toBe(provider);
});

test("keeps an in-memory provider as the default", async () => {
  let registered: MemoryProvider | undefined;

  await createRuntime({
    plugins: [definePlugin({
      id: "default-memory-plugin",
      version: "1.0.0",
      register(context) {
        registered = context.memory.get("in-memory");
      },
    })],
  });

  expect(registered?.id).toBe("in-memory");
});
