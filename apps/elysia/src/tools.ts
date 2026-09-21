import { defineTool } from "@lunar/adk";

interface CalculationInput {
  expression: string;
}

const calculationSchema = {
  parse(input: unknown): CalculationInput {
    if (!input || typeof input !== "object" || typeof (input as { expression?: unknown }).expression !== "string") {
      throw new Error("Expected an object with an expression string");
    }
    const expression = (input as { expression: string }).expression.trim();
    if (!expression || expression.length > 200 || !/^[0-9+*/().\s-]+$/.test(expression)) {
      throw new Error("Expression may contain only numbers, whitespace, parentheses, and + - * /");
    }
    return { expression };
  },
  toJSONSchema: () => ({
    type: "object",
    properties: { expression: { type: "string", description: "An arithmetic expression" } },
    required: ["expression"],
    additionalProperties: false,
  }),
};

function calculate(expression: string): number {
  const tokens = expression.match(/\d+(?:\.\d+)?|[()+*/-]/g) ?? [];
  if (tokens.join("") !== expression.replace(/\s+/g, "")) throw new Error("Invalid expression");
  let position = 0;
  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const expressionValue = (): number => {
    let value = term();
    while (peek() === "+" || peek() === "-") {
      const operator = take();
      const right = term();
      value = operator === "+" ? value + right : value - right;
    }
    return value;
  };
  const term = (): number => {
    let value = factor();
    while (peek() === "*" || peek() === "/") {
      const operator = take();
      const right = factor();
      if (operator === "/" && right === 0) throw new Error("Cannot divide by zero");
      value = operator === "*" ? value * right : value / right;
    }
    return value;
  };
  const factor = (): number => {
    if (peek() === "+" || peek() === "-") {
      const negative = take() === "-";
      const value = factor();
      return negative ? -value : value;
    }
    if (take() === "(") {
      const value = expressionValue();
      if (take() !== ")") throw new Error("Unclosed parenthesis");
      return value;
    }
    const value = Number(tokens[position - 1]);
    if (!Number.isFinite(value)) throw new Error("Expected a number");
    return value;
  };
  const value = expressionValue();
  if (position !== tokens.length || !Number.isFinite(value)) throw new Error("Invalid expression");
  return Object.is(value, -0) ? 0 : value;
}

export const calculatorTool = defineTool<CalculationInput, number>({
  name: "calculate",
  description: "Evaluate a basic arithmetic expression safely.",
  schema: calculationSchema,
  execute: ({ expression }) => calculate(expression),
});

export const currentTimeTool = defineTool<Record<string, never>, string>({
  name: "current_time",
  description: "Get the current UTC time as an ISO 8601 timestamp.",
  schema: {
    parse: () => ({}),
    toJSONSchema: () => ({ type: "object", properties: {}, additionalProperties: false }),
  },
  execute: () => new Date().toISOString(),
});

export const elysiaTools = [currentTimeTool, calculatorTool];
