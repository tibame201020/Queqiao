import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
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

describe("workspace CLI", () => {
  it("adds another authorized Workspace without introducing a default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-cli-"));
    const one = path.join(root, "one"); const two = path.join(root, "My Project"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    const answers = [two, "", "My Project", "3"];
    const questions: string[] = [];
    const result: any = await addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], async (question) => { questions.push(question); return answers.shift() || ""; });
    const config = await readRuntimeConfig(configFile);
    expect(result).toMatchObject({ added: true, workspace: { id: "my-project", displayName: "My Project", profile: "coding" } });
    expect(config.workspaces.map((workspace) => workspace.id)).toEqual(["one", "my-project"]);
    expect(questions[0]).toBe(`Workspace path [${process.cwd()}]: `);
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

  it("derives safe Workspace ids", () => {
    expect(workspaceCliInternals.suggestedWorkspaceId("C:\\work\\123 Project")).toBe("workspace-123-project");
    expect(workspaceCliInternals.suggestedWorkspaceId("/tmp/My Project")).toBe("my-project");
  });
});
