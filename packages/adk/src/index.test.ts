import { expect, test } from "bun:test";
import { createRuntime, defineAgent, definePlugin, defineTool } from "./index";

test("exposes the stable ADK facade", () => {
  expect(createRuntime).toBeFunction();
  expect(defineAgent).toBeFunction();
  expect(defineTool).toBeFunction();
  expect(definePlugin).toBeFunction();
});
