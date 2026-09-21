export class StorageConflictError extends Error {
  constructor(
    readonly resource: string,
    readonly id: string,
    readonly expectedRevision: number | undefined,
    readonly actualRevision: number | undefined,
  ) {
    super(`Storage conflict for ${resource}/${id}`);
    this.name = "StorageConflictError";
  }
}
