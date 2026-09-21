export interface Command {
  id: string;
  handler: (...args: unknown[]) => unknown;
}

export class CommandRegistry {
  private commands = new Map<string, Command>();

  register(command: Command): void {
    this.commands.set(command.id, command);
  }

  get(id: string): Command | undefined {
    return this.commands.get(id);
  }
}

export class SchemaRegistry {
  private schemas = new Map<string, unknown>();

  register(id: string, schema: unknown): void {
    this.schemas.set(id, schema);
  }

  get(id: string): unknown {
    return this.schemas.get(id);
  }
}
