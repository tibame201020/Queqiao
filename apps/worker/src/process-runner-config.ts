import type { RuntimeConfig } from "@queqiao/config";
import { MAX_PROCESS_OUTPUT_BYTES, ProcessRunner } from "@queqiao/process-runtime";

// A single ProcessRunner is owned by the Worker; all its Workspaces share these pools.
export function createConfiguredProcessRunner(worker: NonNullable<RuntimeConfig["worker"]>): ProcessRunner {
  const process = worker.process;
  return new ProcessRunner(
    process.foregroundConcurrency,
    MAX_PROCESS_OUTPUT_BYTES,
    process.backgroundConcurrency,
    process.jobQueueLimit,
    process.jobRetentionMs,
    process.sessionConcurrency,
  );
}
