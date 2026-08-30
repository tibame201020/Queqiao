import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import {
  createAccessProfile,
  deleteAccessProfile,
  editAccessProfile,
  editManagedWorkspace,
  getManagedWorkspaceInfo,
  listAccessProfiles,
  listManagedWorkspaces,
  renameAccessProfile,
} from "./workspace-management.js";

const ORIGINAL_ENV = {
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  HOME: process.env.HOME,
  XDG_DATA_HOME: process.env.XDG_DATA_HOME,
};

afterEach(() => {
  for (const [key, value] of Object.entries(ORIGINAL_ENV)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function isolateProfileStore(root: string) {
  if (process.platform === "win32") {
    process.env.LOCALAPPDATA = root;
  } else {
    process.env.HOME = root;
    process.env.XDG_DATA_HOME = path.join(root, "data");
  }
}

function workerConfig(root: string, workspaceRoot: string) {
  return {
    version: 1 as const,
    worker: {
      workerId: crypto.randomUUID(),
      environmentId: "windows",
      listen: { host: "127.0.0.1" as const, port: 7576 },
      tokenFile: path.join(root, "worker.secret"),
    },
    workspaces: [{
      id: "one",
      displayName: "One",
      root: workspaceRoot,
      profile: "coding" as const,
      tools: { allow: ["read_file"], deny: [], explicit: [] },
      commands: { allow: [] },
    }],
  };
}

describe("Workspace Management", () => {
  it("lists and inspects Workspaces without exposing raw config plumbing", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-management-info-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");

    const inventory: any = await listManagedWorkspaces(configFile);
    expect(inventory.workspaces).toEqual([expect.objectContaining({ id: "one", displayName: "One", root: one })]);
    expect(inventory.workspaces[0].access).toMatchObject({ mode: "explicit", tools: ["read_file"], allowedExecutables: [] });

    const info: any = await getManagedWorkspaceInfo(configFile, ["--workspace", "one"]);
    expect(info.workspace).toMatchObject({ id: "one", displayName: "One", root: one });
  });

  it("edits Workspace identity atomically while preserving its generated id and access policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-management-edit-"));
    const one = path.join(root, "one"); const moved = path.join(root, "moved"); await mkdir(one); await mkdir(moved);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");

    const result: any = await editManagedWorkspace(configFile, ["--workspace", "one", "--root", moved, "--display-name", "Primary"]);
    expect(result.workspace).toMatchObject({ id: "one", displayName: "Primary", root: await import("node:fs/promises").then(({ realpath }) => realpath(moved)) });
    const persisted = (await readRuntimeConfig(configFile)).workspaces[0]!;
    expect(persisted.id).toBe("one");
    expect(persisted.tools).toEqual({ allow: ["read_file"], deny: [], explicit: [] });
  });

  it("rejects editing a Workspace onto an already-authorized canonical root", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-management-duplicate-"));
    const one = path.join(root, "one"); const two = path.join(root, "two"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    const config = workerConfig(root, one);
    await writeFile(configFile, serializeRuntimeConfig({
      ...config,
      workspaces: [...config.workspaces, { id: "two", displayName: "Two", root: two, profile: "coding", tools: { allow: ["read_file"], deny: [], explicit: [] }, commands: { allow: [] } }],
    }), "utf8");

    await expect(editManagedWorkspace(configFile, ["--workspace", "one", "--root", two])).rejects.toThrow(/already authorized/i);
    expect((await readRuntimeConfig(configFile)).workspaces[0]!.root).toBe(one);
  });

  it("manages custom Access Profiles as detached templates without mutating existing Workspaces", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-management-profiles-"));
    isolateProfileStore(root);
    const workspaceRoot = path.join(root, "project"); await mkdir(workspaceRoot);
    const configFile = path.join(root, "worker.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, workspaceRoot)), "utf8");
    const before = await readRuntimeConfig(configFile);

    const created: any = await createAccessProfile(["--name", "coding-safe", "--tools", "read_file,write_file,run", "--commands", "git,npm"]);
    expect(created.profile).toMatchObject({ name: "coding-safe", allowedExecutables: ["git", "npm"] });
    const listed: any = await listAccessProfiles();
    expect(listed.profiles.map((profile: any) => profile.name)).toEqual(expect.arrayContaining(["Reader", "Editor", "coding-safe"]));

    const edited: any = await editAccessProfile(["--profile", "coding-safe", "--tools", "read_file,edit_file"]);
    expect(edited.affectedWorkspaces).toBe(0);
    expect(edited.profile.allowedExecutables).toEqual([]);

    const renamed: any = await renameAccessProfile(["--profile", "coding-safe", "--to", "review-safe"]);
    expect(renamed).toMatchObject({ from: "coding-safe", affectedWorkspaces: 0, profile: { name: "review-safe" } });

    const deleted: any = await deleteAccessProfile(["--profile", "review-safe", "--force"]);
    expect(deleted).toMatchObject({ deleted: true, affectedWorkspaces: 0 });
    expect(await readRuntimeConfig(configFile)).toEqual(before);
  });

  it("keeps built-in Access Profiles immutable", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-management-builtins-"));
    isolateProfileStore(root);
    await expect(createAccessProfile(["--name", "Reader", "--tools", "read_file"])).rejects.toThrow(/built-in.*immutable/i);
    await expect(renameAccessProfile(["--profile", "Reader", "--to", "reader-new"])).rejects.toThrow(/built-in.*immutable/i);
    await expect(deleteAccessProfile(["--profile", "Editor", "--force"])).rejects.toThrow(/built-in.*immutable/i);
  });
});
