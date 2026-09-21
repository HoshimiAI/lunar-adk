import type { Run, RunStore, Session, SessionStore, StorageBundle, WorkflowRun, WorkflowStore } from "@lunar/foundation";

export interface MongoCollection<T> {
  replaceOne(filter: { id: string }, replacement: T, options: { upsert: true }): Promise<unknown>;
  findOne(filter: { id: string }): Promise<T | null>;
}

export interface MongoDatabase {
  collection<T>(name: string): MongoCollection<T>;
}

export interface MongoStorageOptions {
  database: MongoDatabase;
  collectionPrefix?: string;
  close?(): void | Promise<void>;
}

class MongoStore<T extends { id: string }> {
  constructor(private readonly collection: MongoCollection<T>) {}

  async save(value: T): Promise<void> {
    await this.collection.replaceOne({ id: value.id }, value, { upsert: true });
  }

  async get(id: string): Promise<T | undefined> {
    return (await this.collection.findOne({ id })) ?? undefined;
  }
}

export interface MongoStores extends StorageBundle {
  runStore: RunStore;
  sessionStore: SessionStore;
  workflowStore: WorkflowStore;
}

export function createMongoStores(options: MongoStorageOptions): MongoStores {
  const prefix = options.collectionPrefix ?? "lunar";
  return {
    runStore: new MongoStore<Run>(options.database.collection(`${prefix}_runs`)),
    sessionStore: new MongoStore<Session>(options.database.collection(`${prefix}_sessions`)),
    workflowStore: new MongoStore<WorkflowRun>(options.database.collection(`${prefix}_workflow_runs`)),
    close: options.close,
  };
}
