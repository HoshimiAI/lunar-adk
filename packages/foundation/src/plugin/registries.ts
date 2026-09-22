export interface Command {
  id: string;
  handler: (...args: unknown[]) => unknown;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    if (!command.id.trim()) throw new Error("Command id must not be empty");
    if (this.commands.has(command.id)) throw new Error(`Command "${command.id}" is already registered`);
    if (typeof command.handler !== "function") throw new TypeError(`Command "${command.id}" must have a handler`);
    this.commands.set(command.id, command);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }
}

export class SchemaRegistry {
  private schemas = new Map<string, unknown>();

  register(id: string, schema: unknown): void {
    if (!id.trim()) throw new Error("Schema id must not be empty");
    if (this.schemas.has(id)) throw new Error(`Schema "${id}" is already registered`);
    if (schema === undefined || schema === null) throw new TypeError(`Schema "${id}" must be defined`);
    this.schemas.set(id, schema);
  }

  get(id: string): unknown {
    return this.schemas.get(id);
  }
}
