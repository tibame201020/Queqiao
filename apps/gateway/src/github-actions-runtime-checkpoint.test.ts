import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GitHubActionsRuntimeCoordinator, GitHubActionsRuntimeClaimRegistry,
  GitHubActionsRuntimeProvider, type GitHubActionsApi,
} from "@queqiao/runtime-provider-github-actions";
import { GitHubActionsRuntimeCheckpointStore } from "./github-actions-runtime-checkpoint.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop()!, { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-runtime-checkpoint-"));
  roots.push(root);
  const file = path.join(root, "state", "runtime-checkpoint.json");
  const journal = new GitHubActionsRuntimeCheckpointStore(file);
  const cancel = vi.fn(async () => undefined);
  const dispatch = vi.fn(async () => ({
    runId: 78912, runUrl: "https://api.github.test/runs/78912", htmlUrl: "https://github.test/runs/78912",
  }));
  const api: GitHubActionsApi = { dispatch, cancel };
  const coordinator = () => {
    const claims = new GitHubActionsRuntimeClaimRegistry("urn:runtime");
    const provider = new GitHubActionsRuntimeProvider({
      owner: "test-org", repo: "runtime", workflowId: "worker.yml", ref: "main",
      gatewayUrl: "https://test.example/", api, claimRegistry: claims,
    });
    return new GitHubActionsRuntimeCoordinator(provider, claims, undefined, journal);
  };
  return { root, file, journal, cancel, dispatch, coordinator };
}

describe("GitHub Actions runtime restart containment", () => {
  it("persists a live run without secrets and cancels it before a restarted Gateway accepts requests", async () => {
    const { file, journal, cancel, coordinator } = await fixture();
    const first = coordinator();
    const lease = await first.provision({ ttlSeconds: 180, metadata: { purpose: "recovery-test" } });
    const checkpoint = await readFile(file, "utf8");
    expect(checkpoint).toContain("github-actions-run:78912");
    expect(checkpoint).not.toMatch(/access_token|approval_secret|password|oauth_client/i);
    expect((await journal.load()).at(0)?.leaseId).toBe(lease.leaseId);

    const restarted = coordinator();
    await restarted.recoverPending();
    expect(cancel).toHaveBeenCalledWith({ owner: "test-org", repo: "runtime", runId: 78912 });
    expect(await journal.load()).toEqual([]);
    await restarted.recoverPending();
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("fails closed if orphan cancellation fails and retains the record for retry", async () => {
    const { journal, cancel, coordinator } = await fixture();
    await coordinator().provision({ ttlSeconds: 180 });
    cancel.mockRejectedValueOnce(new Error("GitHub cancellation unavailable"));
    await expect(coordinator().recoverPending()).rejects.toThrow(/cancellation unavailable/);
    expect(await journal.load()).toHaveLength(1);
    await coordinator().recoverPending();
    expect(await journal.load()).toEqual([]);
  });

  it("rejects a corrupt journal rather than forgetting active Workers", async () => {
    const { file, coordinator } = await fixture();
    await writeFile(file, JSON.stringify({ version: 1, leases: [{ leaseId: "invalid" }] }), "utf8").catch(async () => {
      const { mkdir } = await import("node:fs/promises");
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, JSON.stringify({ version: 1, leases: [{ leaseId: "invalid" }] }), "utf8");
    });
    await expect(coordinator().recoverPending()).rejects.toThrow();
  });

  it("removes checkpoint after ordinary lease disposal", async () => {
    const { journal, cancel, coordinator } = await fixture();
    const first = coordinator();
    const l = await first.provision({ ttlSeconds: 180 });
    await first.fail(l.leaseId, "local cancellation");
    expect(await journal.load()).toEqual([]);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("serializes concurrent checkpoint writes so old snapshots cannot overwrite newer leases", async () => {
    const { coordinator } = await fixture();
    let releaseFirst!: () => void;
    const firstWriteStarted = Promise.withResolvers<void>();
    const holdFirstWrite = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const observed: number[] = [];
    let writesStarted = 0;
    const journal = {
      load: async () => [],
      save: async (leases: readonly unknown[]) => {
        if (++writesStarted === 1) {
          firstWriteStarted.resolve();
          await holdFirstWrite;
        }
        observed.push(leases.length);
      },
    };
    const current = coordinator();
    const subject = new GitHubActionsRuntimeCoordinator(current.provider, current.claims, undefined, journal);
    const first = subject.provision({ ttlSeconds: 180 });
    await firstWriteStarted.promise;
    const second = subject.provision({ ttlSeconds: 180 });
    await new Promise((resolve) => setTimeout(resolve, 5));
    releaseFirst();
    await Promise.all([first, second]);
    expect(observed).toEqual([1, 2]);
  });
  it("rejects and compensates dispatch when checkpoint write fails", async () => {
    const { cancel, coordinator } = await fixture();
    const first = coordinator();
    const failingJournal = {
      load: async () => [],
      save: async () => { throw new Error("disk failure"); },
    };
    const second = new GitHubActionsRuntimeCoordinator(first.provider, first.claims, undefined, failingJournal);
    await expect(second.provision({ ttlSeconds: 180 })).rejects.toThrow(/disk failure/);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});
