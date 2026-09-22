import { StorageConflictError, type Run, type RunStore, type Session, type SessionStore, type StorageBundle, type WorkflowRun, type WorkflowStore, type SaveOptions } from "@lunar/foundation";

export interface MongoCollection<T> {
  insertOne(document: T): Promise<unknown>;
  replaceOne(filter: Record<string, unknown>, replacement: T, options: { upsert: false }): Promise<{ matchedCount: number }>;
  findOne(filter: { id: string }): Promise<T | null>;
  find?(filter: Record<string, unknown>): { toArray(): Promise<T[]> };
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
    if (options.expectedRevision === undefined) {
      const saved = { ...value, revision: 0 } as T;
      try {
        await this.collection.insertOne(saved);
      } catch (error) {
        if ((error as { code?: number }).code === 11000) {
          const current = await this.get(value.id);
          throw new StorageConflictError("mongo", value.id, undefined, current?.revision);
        }
        throw error;
      }
      return saved;
    }
    const saved = { ...value, revision: options.expectedRevision + 1 } as T;
    const revisionFilter = options.expectedRevision === 0
      ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] }
      : { revision: options.expectedRevision };
    const result = await this.collection.replaceOne({ id: value.id, ...revisionFilter }, saved, { upsert: false });
    if (result.matchedCount !== 1) {
      const current = await this.get(value.id);
      throw new StorageConflictError("mongo", value.id, options.expectedRevision, current?.revision);
    }
    return saved;
  }

  async get(id: string): Promise<T | undefined> {
    return (await this.collection.findOne({ id })) ?? undefined;
  }

  async listRecoverable(): Promise<T[]> {
    if (!this.collection.find) {
      throw new Error("Mongo collection does not support workflow recovery listing");
    }
    return this.collection.find({ status: "running" }).toArray();
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
    capabilities: { optimisticConcurrency: true, atomicRunSession: false },
    runStore: new MongoStore<Run>(options.database.collection(`${prefix}_runs`)),
    sessionStore: new MongoStore<Session>(options.database.collection(`${prefix}_sessions`)),
    workflowStore: new MongoStore<WorkflowRun>(options.database.collection(`${prefix}_workflow_runs`)),
    close: options.close,
  };
}
