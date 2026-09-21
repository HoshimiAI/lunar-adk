export type JSONSchema = Record<string, unknown>;

export interface SchemaLike<T = unknown> {
  parse(input: unknown): T;
  toJSONSchema(): JSONSchema;
}
