import { runtimeConfigSchema, workerProcessConfigSchema, type RuntimeConfig, type WorkerProcessConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";

// Key names are one-to-one with validated Worker-wide YAML configuration.
export const processFlags = {
  "foreground-concurrency": "foregroundConcurrency",
  "background-concurrency": "backgroundConcurrency",
  "session-concurrency": "sessionConcurrency",
  "job-queue-limit": "jobQueueLimit",
  "job-retention-ms": "jobRetentionMs",
} as const satisfies Record<string, keyof WorkerProcessConfig>;

export async function configureWorkerProcess(configFile: string, args: readonly string[]) {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const patch: Record<string, number> = {};
  for (const [flag, field] of Object.entries(processFlags)) {
    const index = args.indexOf(`--${flag}`);
    if (index < 0) continue;
    const raw = args[index + 1];
    if (!raw || !/^(0|[1-9][0-9]*)$/.test(raw)) throw new Error(`--${flag} requires a non-negative integer`);
    patch[field] = Number(raw);
  }
  const reset = args.includes("--defaults");
  if (reset && Object.keys(patch).length) throw new Error("--defaults cannot be combined with individual process limits");
  const current = await store.read();
  if (!current.worker) throw new Error("Worker configuration is required");
  if (!reset && !Object.keys(patch).length) return { changed: false, process: current.worker.process, restartRequired: false };
  // Validate before writing and update atomically; other fields and memberships remain intact.
  const process = workerProcessConfigSchema.parse(reset ? {} : { ...current.worker.process, ...patch });
  const updated = await store.update((value) => ({
    ...value, worker: { ...value.worker!, process },
  }));
  return { changed: true, process: updated.worker!.process, restartRequired: true };
}
