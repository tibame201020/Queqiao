import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import { environmentIdSchema, workerIdSchema } from "@queqiao/contracts";

export const TEST_WORKER_ID = "11111111-1111-4111-8111-111111111111";
export const TEST_WORKER_CREDENTIAL = "queqiao-test-worker-credential-at-least-thirty-two-bytes";

export async function seedTestWorkerMembership(input: {
  stateDirectory: string;
  environmentId: string;
  endpoint: string;
  workerId?: string;
  credential?: string;
}): Promise<void> {
  await mkdir(input.stateDirectory, { recursive: true });
  const credentialFile = path.join(input.stateDirectory, `test-${input.environmentId}.worker.secret`);
  await writeFile(credentialFile, `${input.credential ?? TEST_WORKER_CREDENTIAL}\n`, "utf8");
  const store = new WorkerMembershipStore(input.stateDirectory);
  await store.replace({ version: 1, workers: [{
    workerId: workerIdSchema.parse(input.workerId ?? TEST_WORKER_ID),
    environmentId: environmentIdSchema.parse(input.environmentId),
    transport: { type: "http", endpoint: input.endpoint },
    credentialRefs: [{ kind: "secret-file", path: credentialFile }],
  }] });
}
