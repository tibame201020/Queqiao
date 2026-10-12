import { randomUUID } from "node:crypto";
import { open, readFile, rename, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runtimeLeaseSchema, type RuntimeLease } from "@queqiao/runtime-control";
import { secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";
import type { GitHubActionsRuntimeJournal } from "@queqiao/runtime-provider-github-actions";

const checkpointSchema = z.object({
  version: z.literal(1),
  leases: z.array(runtimeLeaseSchema).max(128),
});

/**
 * Persists only GitHub Actions lease descriptors. No OAuth principals,
 * access tokens, browser sessions or cookies are stored.
 */
export class GitHubActionsRuntimeCheckpointStore implements GitHubActionsRuntimeJournal {
  constructor(readonly file: string) {}

  async load(): Promise<RuntimeLease[]> {
    try {
      const data = checkpointSchema.parse(JSON.parse(await readFile(this.file, "utf8")));
      return data.leases;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async save(leases: readonly RuntimeLease[]): Promise<void> {
    const data = checkpointSchema.parse({ version: 1, leases });
    const dir = path.dirname(this.file);
    await secureRuntimeDirectory(dir);
    const temporary = path.join(dir, `.runtime-checkpoint-${randomUUID()}.tmp`);
    let handle: Awaited<ReturnType<typeof open>> | undefined;
    try {
      handle = await open(temporary, "wx", 0o600);
      await handle.writeFile(JSON.stringify(data) + "\n", "utf8");
      await handle.sync();
      await handle.close();
      handle = undefined;
      await secureRuntimeFile(temporary);
      await rename(temporary, this.file);
      await secureRuntimeFile(this.file);
      if (process.platform !== "win32") {
        const directoryHandle = await open(dir, "r");
        try { await directoryHandle.sync(); } finally { await directoryHandle.close(); }
      }
    } finally {
      if (handle) await handle.close().catch(() => undefined);
      await rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}
