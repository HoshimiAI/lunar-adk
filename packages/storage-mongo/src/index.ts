import { StorageConflictError, type Run, type RunStore, type Session, type SessionStore, type StorageBundle, type WorkflowRun, type WorkflowStore, type SaveOptions } from "@lunar/foundation";

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

class MongoStore<T extends { id: string; revision?: number }> {
  constructor(private readonly collection: MongoCollection<T>) {}

  async save(value: T, options: SaveOptions = {}): Promise<T> {
    const current = await this.get(value.id);
    if (options.expectedRevision !== undefined && (current?.revision ?? 0) !== options.expectedRevision) {
      throw new StorageConflictError("mongo", value.id, options.expectedRevision, current?.revision);
    }
    const saved = { ...value, revision: (current?.revision ?? -1) + 1 } as T;
    await this.collection.replaceOne({ id: value.id }, saved, { upsert: true });
    return saved;
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
