import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import gitExtension, { GIT_EXTENSION_MANIFEST } from "@queqiao/extension-git";
import type { InstalledExtensionConfig } from "@queqiao/config";
import { ExtensionHost } from "@queqiao/tool-runtime";
import { createWorkerApp } from "./app.js";
import { getWorkerCoreToolDefinitions, type WorkerToolContext } from "./core-tools.js";

const exec = promisify(execFile);
let temporary: string | undefined;
let external: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); if (external) await rm(external, { recursive: true, force: true }); temporary = undefined; external = undefined; });

const installed: InstalledExtensionConfig = { trusted: true, source: { kind: "local-module", module: "@queqiao/extension-git" }, activation: { kind: "global" }, manifest: GIT_EXTENSION_MANIFEST };
async function git(cwd: string, args: string[]) { return exec("git", args, { cwd, windowsHide: true }); }
async function initializeRepo(root: string) {
  await mkdir(root, { recursive: true });
  await git(root, ["init"]);
  await git(root, ["config", "user.email", "queqiao-test@example.invalid"]);
  await git(root, ["config", "user.name", "Queqiao Test"]);
  await writeFile(path.join(root, "README.md"), "initial\n");
  await git(root, ["add", "README.md"]);
  await git(root, ["commit", "-m", "initial"]);
}
async function host() {
  const environmentId = process.platform === "win32" ? "windows" : "linux";
  const result = new ExtensionHost<WorkerToolContext>([installed], { kind: "worker", environmentId }, process.cwd(), async (specifier) => {
    if (specifier !== "@queqiao/extension-git") throw new Error(`unexpected module ${specifier}`);
    return { default: gitExtension };
  }, getWorkerCoreToolDefinitions().map((tool) => tool.name));
  await result.load();
  return result;
}
function tool(app: Awaited<ReturnType<typeof createWorkerApp>>, name: string, body: unknown, status = 200) {
  return request(app).post(`/v1/tools/${name}`).set("x-queqiao-worker-token", "test-worker-token").send(body).expect(status);
}

describe("first-party Git extension", () => {
  it("discovers, reads, creates, and removes contained repositories/worktrees with native Git", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-git-"));
    const repo = path.join(temporary, "repo");
    await initializeRepo(repo);
    await mkdir(path.join(temporary, "worktrees"));
    const app = await createWorkerApp({ environmentId: process.platform === "win32" ? "windows" : "linux", defaultWorkspaceId: "coding", workerToken: "test-worker-token", extensionHost: await host(), workspaces: [{ id: "coding", displayName: "Coding", root: temporary, profile: "coding", commands: { allow: ["git"] } }] });

    const discovered = await tool(app, "git_repositories", { workspaceId: "coding", path: ".", depth: 3 });
    expect(discovered.body.result.repositories).toEqual(expect.arrayContaining([expect.objectContaining({ path: "repo", kind: "repository" })]));
    const status = await tool(app, "git_status", { workspaceId: "coding", repositoryPath: "repo" });
    expect(status.body.result.repositoryPath).toBe("repo");
    const proxySearch = await tool(app, "extension", { workspaceId: "coding", operation: "search", query: "git status" });
    expect(proxySearch.body.result.matches).toEqual(expect.arrayContaining([expect.objectContaining({ extensionId: "dev.queqiao.git", capability: "git_status" })]));
    const proxyDescribe = await tool(app, "extension", { workspaceId: "coding", operation: "describe", extensionId: "dev.queqiao.git", capability: "git_status" });
    expect(proxyDescribe.body.result.capability.name).toBe("git_status");
    const proxyCall = await tool(app, "extension", { workspaceId: "coding", operation: "call", extensionId: "dev.queqiao.git", capability: "git_status", arguments: { repositoryPath: "repo" } });
    expect(proxyCall.body.result.result.repositoryPath).toBe("repo");
    const branches = await tool(app, "git_branches", { workspaceId: "coding", repositoryPath: "repo" });
    expect(branches.body.result.branches.some((entry: { current: boolean }) => entry.current)).toBe(true);
    const log = await tool(app, "git_log", { workspaceId: "coding", repositoryPath: "repo", limit: 5 });
    expect(log.body.result.commits[0].subject).toBe("initial");
    await writeFile(path.join(repo, "README.md"), "initial\nchanged\n");
    const diff = await tool(app, "git_diff", { workspaceId: "coding", repositoryPath: "repo" });
    expect(diff.body.result.diff).toContain("+changed");

    await tool(app, "git_worktree_create", { workspaceId: "coding", repositoryPath: "repo", targetPath: "worktrees/failed", ref: "missing-ref", newBranch: "failed-test" }, 400);
    await expect(access(path.join(temporary, "worktrees", "failed"))).rejects.toThrow();
    const created = await tool(app, "git_worktree_create", { workspaceId: "coding", repositoryPath: "repo", targetPath: "worktrees/feature", ref: "HEAD", newBranch: "feature-test" });
    expect(created.body.result.targetPath).toBe("worktrees/feature");
    const worktreeStatus = await tool(app, "git_status", { workspaceId: "coding", repositoryPath: "worktrees/feature" });
    expect(worktreeStatus.body.result.repositoryPath).toBe("worktrees/feature");
    await tool(app, "git_worktree_remove", { workspaceId: "coding", repositoryPath: "repo", targetPath: "worktrees/feature" });
  });

  it("keeps Git execution behind coding profile and command allow policy", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-git-policy-"));
    await initializeRepo(path.join(temporary, "repo"));
    const app = await createWorkerApp({ environmentId: process.platform === "win32" ? "windows" : "linux", defaultWorkspaceId: "editor", workerToken: "test-worker-token", extensionHost: await host(), workspaces: [
      { id: "editor", displayName: "Editor", root: temporary, profile: "editor", commands: { allow: ["git"] } },
      { id: "coding-denied", displayName: "Coding denied", root: temporary, profile: "coding", commands: { allow: [] } },
    ] });
    await tool(app, "git_status", { workspaceId: "editor", repositoryPath: "repo" }, 403);
    await tool(app, "git_status", { workspaceId: "coding-denied", repositoryPath: "repo" }, 403);
  });

  it("rejects externally-backed worktrees and link/junction repository paths", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-git-contained-"));
    external = await mkdtemp(path.join(os.tmpdir(), "queqiao-git-external-"));
    await initializeRepo(external);
    const backed = path.join(temporary, "external-backed");
    await git(external, ["worktree", "add", "-b", "external-worktree-test", backed, "HEAD"]);
    const insideRepo = path.join(temporary, "inside");
    await initializeRepo(insideRepo);
    const linked = path.join(temporary, "linked");
    await symlink(insideRepo, linked, process.platform === "win32" ? "junction" : "dir");
    const app = await createWorkerApp({ environmentId: process.platform === "win32" ? "windows" : "linux", defaultWorkspaceId: "coding", workerToken: "test-worker-token", extensionHost: await host(), workspaces: [{ id: "coding", displayName: "Coding", root: temporary, profile: "coding", commands: { allow: ["git"] } }] });
    await tool(app, "git_status", { workspaceId: "coding", repositoryPath: "external-backed" }, 400);
    await tool(app, "git_status", { workspaceId: "coding", repositoryPath: "linked" }, 400);
    await tool(app, "git_status", { workspaceId: "coding", repositoryPath: "../outside" }, 400);
    await tool(app, "git_worktree_create", { workspaceId: "coding", repositoryPath: "inside", targetPath: "../escape", ref: "HEAD", newBranch: "escape-test" }, 400);
    await tool(app, "git_worktree_create", { workspaceId: "coding", repositoryPath: "inside", targetPath: "linked/child", ref: "HEAD", newBranch: "link-parent-test" }, 400);
    await tool(app, "git_worktree_remove", { workspaceId: "coding", repositoryPath: "inside", targetPath: "external-backed" }, 400);
  });
});
