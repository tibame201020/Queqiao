import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { addWorkspace, removeWorkspace, setWorkspaceAccess, updateWorkspaceCommandPolicy, updateWorkspaceToolPolicy, workspaceCliInternals } from "./workspace-cli.js";

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
  it("uses the shared Access profile model for interactive additional Workspaces", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-access-"));
    const workspaceRoot = path.join(root, "project"); await mkdir(workspaceRoot);
    const choose = vi.fn(async (_message: string, options: Array<{ value: string; label: string }>) => {
      expect(options.map((entry) => entry.value)).toEqual(["builtin:reader", "builtin:editor", "__custom_access__"]);
      return "builtin:editor";
    });
    const interactiveWorkspaceCandidate = (workspaceCliInternals as any).interactiveWorkspaceCandidate;
    expect(interactiveWorkspaceCandidate).toBeTypeOf("function");

    const candidate = await interactiveWorkspaceCandidate({
      cwd: root,
      pathPrompt: async () => workspaceRoot,
      prompts: {
        choose,
        multi: vi.fn(async () => { throw new Error("Editor must not open Custom tools"); }),
        commandText: vi.fn(async () => ""),
        text: vi.fn(async () => "Project"),
      },
      profileStore: { list: vi.fn(async () => []), save: vi.fn(async () => undefined) },
    });

    expect(candidate).toMatchObject({
      root: workspaceRoot,
      displayName: "Project",
      profile: "coding",
      tools: { allow: expect.arrayContaining(["read_file", "write_file", "edit_file"]), deny: [], explicit: [] },
      commands: { allow: [] },
    });
    expect(candidate.tools.allow).not.toContain("run");
    expect(candidate.tools.allow).not.toContain("shell");
  });

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

  it("keeps explicit legacy profile mutation as a scriptable capability-ceiling primitive", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-profile-legacy-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");

    const result = await setWorkspaceAccess(configFile, ["profile", "set", "--worker", "windows", "--workspace", "one", "--profile", "editor"]);
    const workspace = (await readRuntimeConfig(configFile)).workspaces[0]!;
    expect(result).toMatchObject({ changed: true, workspaceId: "one", profile: "editor", mode: "legacy-profile" });
    expect(workspace.profile).toBe("editor");
    expect(workspace.tools).toEqual({ allow: [], deny: [], explicit: [] });
    expect(workspace.commands).toEqual({ allow: [] });
  });

  it("applies the shared Access Profile flow to an existing Workspace when --profile is omitted", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-profile-interactive-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    const choose = vi.fn(async (message: string, options: Array<{ value: string; label: string; description?: string }>) => {
      if (message === "Workspace") {
        expect(options).toEqual([{ value: "one", label: "one", description: one }]);
        return "one";
      }
      if (message === "Access profile") return "builtin:editor";
      throw new Error(`Unexpected choice prompt: ${message}`);
    });

    const result = await setWorkspaceAccess(configFile, ["profile", "set", "--worker", "windows"], {
      interactive: true,
      prompts: {
        choose,
        multi: vi.fn(async () => { throw new Error("Editor must not open Custom tools"); }),
        commandText: vi.fn(async () => ""),
        text: vi.fn(async () => { throw new Error("Editor must not ask for text"); }),
      },
      profileStore: { list: vi.fn(async () => []), save: vi.fn(async () => undefined) },
    });

    const workspace = (await readRuntimeConfig(configFile)).workspaces[0]!;
    expect(result).toMatchObject({ changed: true, workspaceId: "one", mode: "access-profile" });
    expect(workspace.profile).toBe("coding");
    expect(workspace.tools.allow).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file"]));
    expect(workspace.tools.allow).not.toContain("run");
    expect(workspace.tools.allow).not.toContain("shell");
    expect(workspace.commands).toEqual({ allow: [] });
    expect(workspace.root).toBe(one);
    expect(workspace.displayName).toBe("one");
  });

  it("allows one tool from a wildcard policy without accidentally converting it into a one-tool allowlist", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-tool-wildcard-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    const config = workerConfig(root, one);
    config.workspaces[0]!.profile = "coding";
    config.workspaces[0]!.tools.deny = ["write_file"];
    await writeFile(configFile, serializeRuntimeConfig(config), "utf8");

    const result = await updateWorkspaceToolPolicy(configFile, ["tool", "allow", "--workspace", "one", "--tool", "write_file"]);
    const workspace = (await readRuntimeConfig(configFile)).workspaces[0]!;
    expect(result).toMatchObject({ changed: true, workspaceId: "one", tool: "write_file", decision: "allow" });
    expect(workspace.tools).toEqual({ allow: [], deny: [], explicit: [] });
  });

  it("preserves explicit matrix semantics while granting shell explicitly", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-tool-explicit-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    const config = workerConfig(root, one);
    config.workspaces[0]!.profile = "coding";
    config.workspaces[0]!.tools.allow = ["read_file"];
    config.workspaces[0]!.tools.deny = ["shell"];
    await writeFile(configFile, serializeRuntimeConfig(config), "utf8");

    await updateWorkspaceToolPolicy(configFile, ["tool", "allow", "--workspace", "one", "--tool", "shell"]);
    const workspace = (await readRuntimeConfig(configFile)).workspaces[0]!;
    expect(workspace.tools.allow).toEqual(["read_file", "shell"]);
    expect(workspace.tools.deny).toEqual([]);
    expect(workspace.tools.explicit).toEqual(["shell"]);
  });

  it("fails closed instead of turning the last explicit tool entry into wildcard access", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-tool-last-explicit-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    const config = workerConfig(root, one);
    config.workspaces[0]!.profile = "coding";
    config.workspaces[0]!.tools.allow = ["read_file"];
    await writeFile(configFile, serializeRuntimeConfig(config), "utf8");

    await expect(updateWorkspaceToolPolicy(configFile, ["tool", "deny", "--workspace", "one", "--tool", "read_file"]))
      .rejects.toThrow(/last explicitly allowed tool.*wildcard/i);
    expect((await readRuntimeConfig(configFile)).workspaces[0]!.tools).toEqual({ allow: ["read_file"], deny: [], explicit: [] });
  });

  it("adds and removes executable allowlist entries through the Workspace policy handler", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-command-policy-"));
    const one = path.join(root, "one"); await mkdir(one);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");

    await updateWorkspaceCommandPolicy(configFile, ["command", "allow", "--workspace", "one", "--command", "Git"]);
    expect((await readRuntimeConfig(configFile)).workspaces[0]!.commands.allow).toEqual(["git"]);
    await updateWorkspaceCommandPolicy(configFile, ["command", "deny", "--workspace", "one", "--command", "git"]);
    expect((await readRuntimeConfig(configFile)).workspaces[0]!.commands.allow).toEqual([]);
    await expect(updateWorkspaceCommandPolicy(configFile, ["command", "allow", "--workspace", "one", "--command", "git status"]))
      .rejects.toThrow(/executable name without path or shell syntax/i);
  });

  it("rejects the legacy --id input because ids are implementation-managed", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-id-option-"));
    const one = path.join(root, "one"); const two = path.join(root, "two"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    await expect(addWorkspace(configFile, ["workspace", "add", "--worker", "windows", "--root", two, "--id", "manual"])).rejects.toThrow(/ids are generated automatically/i);
  });

  it("uses --display-name for scripted Workspace presentation", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-workspace-display-name-"));
    const one = path.join(root, "one"); const two = path.join(root, "two"); await mkdir(one); await mkdir(two);
    const configFile = path.join(root, "config.yaml");
    await writeFile(configFile, serializeRuntimeConfig(workerConfig(root, one)), "utf8");
    await addWorkspace(configFile, ["workspace", "add", "--worker", "windows", "--root", two, "--display-name", "Project Two", "--profile", "editor"]);
    expect((await readRuntimeConfig(configFile)).workspaces.find(({ root: workspaceRoot }) => workspaceRoot === two)?.displayName).toBe("Project Two");
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
