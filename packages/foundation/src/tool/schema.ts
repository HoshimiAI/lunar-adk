import type { JSONSchema, SchemaLike } from "../types";

export function schemaToJSON(schema: SchemaLike): JSONSchema {
  return schema.toJSONSchema();
}
