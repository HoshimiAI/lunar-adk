import type { Run } from "../run";
import type { Session } from "../session";
import type { WorkflowRun } from "../workflow";
import { StorageConflictError } from "./error";
import type { StorageBundle } from "./types";

async function verifyVersionedStore<T extends { id: string; revision?: number }>(
  save: (value: T, expectedRevision?: number) => Promise<T>,
  get: (id: string) => Promise<T | undefined>,
  fixture: T,
): Promise<void> {
  const created = await save(fixture);
  if (created.revision !== 0) throw new Error(`Expected revision 0 for ${fixture.id}`);
  try {
    await save(fixture);
    throw new Error(`Expected duplicate create conflict for ${fixture.id}`);
  } catch (error) {
    if (!(error instanceof StorageConflictError)) throw error;
  }
  const raced = await Promise.allSettled([
    save(created, created.revision),
    save(created, created.revision),
  ]);
  const fulfilled = raced.filter((result) => result.status === "fulfilled");
  const rejected = raced.filter((result) => result.status === "rejected");
  if (fulfilled.length !== 1 || rejected.length !== 1) throw new Error(`Expected one concurrent write conflict for ${fixture.id}`);
  const rejection = (rejected[0] as PromiseRejectedResult).reason;
  if (!(rejection instanceof StorageConflictError)) throw rejection;
  const updated = (fulfilled[0] as PromiseFulfilledResult<T>).value;
  if (updated.revision !== 1) throw new Error(`Expected revision 1 for ${fixture.id}`);
  if ((await get(fixture.id))?.revision !== 1) throw new Error(`Stored revision mismatch for ${fixture.id}`);
}

export async function verifyStorageBundle(bundle: StorageBundle): Promise<void> {
  if (!bundle.capabilities) throw new Error("Storage bundle must declare capabilities");
  const suffix = crypto.randomUUID();
  const run: Run = {
    id: `contract-run-${suffix}`,
    status: "pending",
    startedAt: Date.now(),
    events: [],
    trace: [],
    artifacts: [],
    usage: { inputTokens: 0, outputTokens: 0 },
  };
  const session: Session = { id: `contract-session-${suffix}`, history: [], runIds: [], runs: [] };
  const workflow: WorkflowRun = {
    id: `contract-workflow-${suffix}`,
    workflow: "contract",
    version: "1",
    status: "pending",
    input: null,
    state: {},
    checkpoints: [],
    childRunIds: [],
    startedAt: Date.now(),
    approvedApprovalIds: [],
  };
  await verifyVersionedStore(
    (value, expectedRevision) => bundle.runStore.save(value, { expectedRevision }),
    (id) => bundle.runStore.get(id),
    run,
  );
  await verifyVersionedStore(
    (value, expectedRevision) => bundle.sessionStore.save(value, { expectedRevision }),
    (id) => bundle.sessionStore.get(id),
    session,
  );
  await verifyVersionedStore(
    (value, expectedRevision) => bundle.workflowStore.save(value, { expectedRevision }),
    (id) => bundle.workflowStore.get(id),
    workflow,
  );
  if (bundle.capabilities?.atomicRunSession && !bundle.saveRunAndSession) {
    throw new Error("Storage declares atomic run/session support without implementing saveRunAndSession");
  }
}
