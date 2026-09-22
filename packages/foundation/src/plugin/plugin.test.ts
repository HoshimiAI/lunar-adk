import { describe, expect, test } from "bun:test";
import { resolveOrder } from "./dependency";
import { PluginRegistry } from "./registry";
import { CommandRegistry, SchemaRegistry } from "./registries";
import type { Plugin } from "./types";

function plugin(id: string, dependencies?: string[]): Plugin {
  return { id, version: "1.0.0", dependencies, register() {} };
}

describe("plugin contracts", () => {
  test("orders dependencies before dependents", () => {
    expect(resolveOrder([plugin("app", ["base"]), plugin("base")]).map(({ id }) => id))
      .toEqual(["base", "app"]);
  });

  test("rejects duplicate or empty plugin IDs", () => {
    expect(() => resolveOrder([plugin("same"), plugin("same")])).toThrow("Duplicate plugin id");
    expect(() => resolveOrder([plugin(" ")])).toThrow("must not be empty");
  });

  test("rejects missing, self, and circular dependencies", () => {
    expect(() => resolveOrder([plugin("app", ["missing"])] )).toThrow("unknown plugin");
    expect(() => resolveOrder([plugin("app", ["app"])] )).toThrow("cannot depend on itself");
    expect(() => resolveOrder([plugin("a", ["b"]), plugin("b", ["a"])] )).toThrow("Circular");
  });

  test("does not silently replace registered plugins, commands, or schemas", () => {
    const plugins = new PluginRegistry();
    plugins.register(plugin("same"));
    expect(() => plugins.register(plugin("same"))).toThrow("already registered");

    const commands = new CommandRegistry();
    commands.register({ id: "same", handler() {} });
    expect(() => commands.register({ id: "same", handler() {} })).toThrow("already registered");

    const schemas = new SchemaRegistry();
    schemas.register("same", {});
    expect(() => schemas.register("same", {})).toThrow("already registered");
  });

  test("starts a plugin after registering it and stops it after a failed start", async () => {
    const { installPlugin } = await import("./lifecycle");
    const calls: string[] = [];
    const context = {} as Parameters<typeof installPlugin>[1];
    await installPlugin({
      ...plugin("lifecycle"),
      register() { calls.push("register"); },
      start() { calls.push("start"); },
      stop() { calls.push("stop"); },
    }, context);
    expect(calls).toEqual(["register", "start"]);

    await expect(installPlugin({
      ...plugin("failing"),
      register() { calls.push("failing-register"); },
      start() { throw new Error("start failed"); },
      stop() { calls.push("failing-stop"); },
    }, context)).rejects.toThrow("start failed");
    expect(calls).toContain("failing-stop");
  });
});
