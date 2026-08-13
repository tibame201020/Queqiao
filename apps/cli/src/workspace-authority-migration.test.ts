import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

function workspace(id: string, root: string) {
  return workspaceConfigSchema.parse({ id, displayName: id, root, profile: "read-only" });
}

describe("Workspace authority config migration", () => {
  it("atomically adds a non-Git Workspace without widening an existing authority root", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-authority-config-"));
    const first = path.join(temporary, "first");
    const second = path.join(temporary, "second");
    await Promise.all([mkdir(first), mkdir(second)]);
    const firstRoot = await resolveWorkspaceAuthorityRoot(first);
    const secondRoot = await resolveWorkspaceAuthorityRoot(second);
    const file = path.join(temporary, "config.yaml");
    const store = new AtomicConfigStore<RuntimeConfig>(file, (value) => runtimeConfigSchema.parse(value));
    await store.initialize(runtimeConfigSchema.parse({ version: 1, workspaces: [workspace("first", firstRoot)] }));
    const before = await readFile(file, "utf8");

    const next = await store.update((current) => ({ ...current, workspaces: [...current.workspaces, workspace("second", secondRoot)] }));
    expect(next.workspaces.map(({ id, root }) => ({ id, root }))).toEqual([
      { id: "first", root: firstRoot },
      { id: "second", root: secondRoot },
    ]);
    expect(next.workspaces[0]?.root).toBe(firstRoot);
    expect(await readFile(file, "utf8")).not.toBe(before);
  });

  it("rejects an invalid authority mutation before replacing the last valid config", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-authority-config-"));
    const root = path.join(temporary, "plain");
    await mkdir(root);
    const canonical = await resolveWorkspaceAuthorityRoot(root);
    const file = path.join(temporary, "config.yaml");
    const store = new AtomicConfigStore<RuntimeConfig>(file, (value) => runtimeConfigSchema.parse(value));
    await store.initialize(runtimeConfigSchema.parse({ version: 1, workspaces: [workspace("plain", canonical)] }));
    const before = await readFile(file, "utf8");
    await expect(store.update((current) => ({ ...current, workspaces: [...current.workspaces, workspace("plain", canonical)] }))).rejects.toThrow();
    expect(await readFile(file, "utf8")).toBe(before);
  });
});
