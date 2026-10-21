import { mkdtemp, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { configureWorkerProcess } from "./worker-process-cli.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture(process?: Record<string, number>) {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-process-cli-")); roots.push(root);
  const file = path.join(root, "config.yaml");
  const workspace = path.join(root, "workspace"); await mkdir(workspace);
  await writeFile(file, serializeRuntimeConfig({
    version: 1, worker: { workerId: "11111111-1111-4111-8111-111111111111", environmentId: "test",
      listen: { port: 7576 }, tokenFile: path.join(root, "token.secret"), ...(process ? { process } : {}) },
    workspaces: [{ id: "test", displayName: "Test", root: workspace, profile: "read-only" }],
  }));
  return file;
}
describe("Worker process configuration CLI", () => {
  it("reads effective defaults without mutating config", async () => {
    const file = await fixture();
    const before = await readFile(file, "utf8");
    expect(await configureWorkerProcess(file, [])).toMatchObject({
      changed: false, restartRequired: false,
      process: { foregroundConcurrency: 8, backgroundConcurrency: 8, sessionConcurrency: 8, jobQueueLimit: 32, jobRetentionMs: 900000 },
    });
    expect(await readFile(file, "utf8")).toBe(before);
  });
  it("updates one setting without dropping the other process limits", async () => {
    const file = await fixture({ backgroundConcurrency: 3 });
    expect(await configureWorkerProcess(file, ["--foreground-concurrency", "4", "--job-queue-limit", "64"])).toMatchObject({
      changed: true, restartRequired: true, process: { foregroundConcurrency: 4, backgroundConcurrency: 3, sessionConcurrency: 8, jobQueueLimit: 64 },
    });
    expect((await readRuntimeConfig(file)).worker?.process.backgroundConcurrency).toBe(3);
  });
  it("rejects invalid changes atomically", async () => {
    const file = await fixture();
    const before = await readFile(file, "utf8");
    await expect(configureWorkerProcess(file, ["--session-concurrency", "9"])).rejects.toThrow();
    await expect(configureWorkerProcess(file, ["--job-retention-ms", "1.5"])).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(before);
  });
  it("restores defaults explicitly", async () => {
    const file = await fixture({ foregroundConcurrency: 2 });
    expect((await configureWorkerProcess(file, ["--defaults"])).process.foregroundConcurrency).toBe(8);
  });
});
