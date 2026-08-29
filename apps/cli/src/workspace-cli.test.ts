import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { addWorkspace, removeWorkspace, workspaceCliInternals } from "./workspace-cli.js";

function workerConfig(root: string, workspaceRoot: string) {
  return {
    version: 1 as const,
    worker: { workerId: crypto.randomUUID(), environmentId: "windows", listen: { host: "127.0.0.1" as const, port: 7576 }, tokenFile: path.join(root, "worker.secret") },
    workspaces: [{ id: "one", displayName: "one", root: workspaceRoot, profile: "read-only" as const, tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
  };
}

async function promptAnswers(answers: string[]) {
  return async () => answers.shift() || "";
}

describe("workspace CLI", () => {
  it("adds another authorized Workspace with an automatically generated id", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-cli-"));
    const one = path.join(root, "one"); const two = path.join(root, "My Project"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    const questions: string[] = [];
    const answers = [two, "My Project", "3"];
    const result: any = await addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], async (question) => { questions.push(question); return answers.shift() || ""; });
    const config = await readRuntimeConfig(configFile);
    expect(result).toMatchObject({ added: true, workspace: { id: "my-project", displayName: "My Project", profile: "coding" } });
    expect(config.workspaces.map((workspace) => workspace.id)).toEqual(["one", "my-project"]);
    expect(questions).toEqual([
      `Workspace path [${process.cwd()}]: `,
      "Display name [My Project]: ",
      "Profile [1=read-only, 2=editor, 3=coding] (1): ",
    ]);
  });

  it("rejects the exact same authorized Workspace path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-duplicate-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    await expect(addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], await promptAnswers([one, "same", "1"]))).rejects.toThrow(/path is already authorized/i);
    expect((await readRuntimeConfig(configFile)).workspaces).toHaveLength(1);
  });

  it("rejects a canonical duplicate when an existing Workspace root is stored through a symlink or junction", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-canonical-duplicate-"));
    const target = path.join(root, "target"); const alias = path.join(root, "alias"); await mkdir(target);
    await symlink(target, alias, process.platform === "win32" ? "junction" : "dir");
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, alias)), "utf8");
    await expect(addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], await promptAnswers([target, "same target", "1"]))).rejects.toThrow(/path is already authorized/i);
    expect((await readRuntimeConfig(configFile)).workspaces).toHaveLength(1);
  });

  it("allows nested Workspace roots so narrower scopes can carry different policy", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-nested-"));
    const parent = path.join(root, "project"); const child = path.join(parent, "sensitive"); await mkdir(child, { recursive: true });
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, parent)), "utf8");
    const result: any = await addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], await promptAnswers([child, "Sensitive", "2"]));
    expect(result).toMatchObject({ added: true, workspace: { displayName: "Sensitive", profile: "editor" } });
    expect((await readRuntimeConfig(configFile)).workspaces).toHaveLength(2);
  });

  it("auto-suffixes Workspace ids when different roots share the same basename", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-id-"));
    const first = path.join(root, "a", "project"); const second = path.join(root, "b", "project"); await mkdir(first, { recursive: true }); await mkdir(second, { recursive: true });
    const configFile = path.join(root, "config.yaml");
    const initial = workerConfig(root, first);
    initial.workspaces[0]!.id = "project";
    await writeFile(configFile, serializeRuntimeConfig(initial), "utf8");
    const result: any = await addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], await promptAnswers([second, "Other project", "1"]));
    expect(result.workspace.id).toBe("project-2");
  });

  it("rejects the legacy --id input because ids are implementation-managed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-id-option-"));
    const one = path.join(root, "one"); const two = path.join(root, "two"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    await expect(addWorkspace(configFile, ["workspace", "add", "--worker", "windows", "--root", two, "--id", "manual"])).rejects.toThrow(/ids are generated automatically/i);
  });

  it("refuses to remove the last Workspace from a configured Worker", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-last-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    await expect(removeWorkspace(configFile, "windows", "one")).rejects.toThrow(/must retain at least one Workspace/);
    expect((await readRuntimeConfig(configFile)).workspaces.map((workspace) => workspace.id)).toEqual(["one"]);
  });

  it("removes any Workspace when another authorized Workspace remains", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-remove-"));
    const one = path.join(root, "one"); const two = path.join(root, "two"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    const initial = workerConfig(root, one);
    await writeFile(configFile, serializeRuntimeConfig({ ...initial, workspaces: [...initial.workspaces, { id: "two", displayName: "two", root: two, profile: "editor", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }] }), "utf8");
    await removeWorkspace(configFile, "windows", "one");
    expect((await readRuntimeConfig(configFile)).workspaces.map((workspace) => workspace.id)).toEqual(["two"]);
  });

  it("derives and deconflicts safe Workspace ids", () => {
    expect(workspaceCliInternals.suggestedWorkspaceId("C:\\work\\123 Project")).toBe("workspace-123-project");
    expect(workspaceCliInternals.suggestedWorkspaceId("/tmp/My Project")).toBe("my-project");
    expect(workspaceCliInternals.uniqueWorkspaceId("/tmp/My Project", ["my-project", "my-project-2"])).toBe("my-project-3");
  });
});
