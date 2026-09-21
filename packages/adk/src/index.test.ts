import { expect, test } from "bun:test";
import { createRuntime, defineAgent, defineTool } from "./index";

test("exposes the stable ADK facade", () => {
  expect(createRuntime).toBeFunction();
  expect(defineAgent).toBeFunction();
  expect(defineTool).toBeFunction();
});
