import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { addWorkspace, workspaceCliInternals } from "./workspace-cli.js";

describe("workspace CLI", () => {
  it("adds the first Workspace interactively and makes it default", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-cli-"));
    const workspaceRoot = path.join(root, "My Project");
    await mkdir(workspaceRoot);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig({ version: 1, worker: { workerId: crypto.randomUUID(), environmentId: "windows", listen: { host: "127.0.0.1", port: 7576 }, tokenFile: path.join(root, "worker.secret") }, workspaces: [] }), "utf8");
    const answers = [workspaceRoot, "", "My Project", "3"];
    const questions: string[] = [];
    const result: any = await addWorkspace(configFile, ["workspace", "add", "--worker", "windows"], async (question) => { questions.push(question); return answers.shift() || ""; });
    const config = await readRuntimeConfig(configFile);
    expect(result).toMatchObject({ added: true, defaultWorkspaceId: "my-project", workspace: { id: "my-project", displayName: "My Project", profile: "coding" } });
    expect(config.worker?.defaultWorkspaceId).toBe("my-project");
    expect(config.workspaces).toHaveLength(1);
    expect(questions[0]).toBe(`Workspace path [${process.cwd()}]: `);
    expect(questions.slice(1)).toEqual(["Workspace id [my-project]: ", "Display name [my-project]: ", "Profile [1=read-only, 2=editor, 3=coding] (1): "]);
  });

  it("keeps the first Workspace default when later Workspaces are added", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-cli-multi-"));
    const one = path.join(root, "one"); const two = path.join(root, "two"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig({ version: 1, worker: { workerId: crypto.randomUUID(), environmentId: "windows", listen: { host: "127.0.0.1", port: 7576 }, tokenFile: path.join(root, "worker.secret"), defaultWorkspaceId: "one" }, workspaces: [{ id: "one", displayName: "one", root: one, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }] }), "utf8");
    await addWorkspace(configFile, ["workspace", "add", "--worker", "windows", "--root", two, "--id", "two", "--name", "two", "--profile", "editor"], async () => { throw new Error("prompt should not be used"); });
    const config = await readRuntimeConfig(configFile);
    expect(config.worker?.defaultWorkspaceId).toBe("one");
    expect(config.workspaces.map((workspace) => workspace.id)).toEqual(["one", "two"]);
  });
  it("derives safe Workspace ids", () => {
    expect(workspaceCliInternals.suggestedWorkspaceId("C:\\work\\123 Project")).toBe("workspace-123-project");
    expect(workspaceCliInternals.suggestedWorkspaceId("/tmp/My Project")).toBe("my-project");
  });
});



