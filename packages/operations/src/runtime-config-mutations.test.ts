import { describe, expect, it } from "vitest";
import { runtimeConfigSchema, type RuntimeConfig } from "@queqiao/config";
import {
  addRuntimeWorkspace,
  decideRuntimeWorkspaceCommand,
  decideRuntimeWorkspaceTool,
  removeRuntimeWorkspace,
  setRuntimeWorkspaceProfile,
  WorkspaceMutationError,
} from "./runtime-config-mutations.js";

function baseConfig(): RuntimeConfig {
  return runtimeConfigSchema.parse({
    version: 1,
    worker: {
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "windows",
      listen: { host: "127.0.0.1", port: 7576 },
      tokenFile: "worker.secret",
      defaultWorkspaceId: "main",
    },
    workspaces: [{
      id: "main",
      displayName: "Main",
      root: "workspace-main",
      profile: "read-only",
      tools: { allow: [], deny: [], explicit: [] },
      commands: { allow: [] },
      stepUp: [],
    }],
  });
}

describe("runtime Workspace mutations", () => {
  it("adds a Workspace without replacing an existing default", () => {
    const next = addRuntimeWorkspace(baseConfig(), { id: "secondary", displayName: "Secondary", root: "workspace-secondary", profile: "coding" });
    expect(next.worker?.defaultWorkspaceId).toBe("main");
    expect(next.workspaces.map((workspace) => workspace.id)).toEqual(["main", "secondary"]);
  });

  it("shares profile, tool, and command policy semantics", () => {
    let next = setRuntimeWorkspaceProfile(baseConfig(), "main", "coding");
    next = decideRuntimeWorkspaceTool(next, "main", "shell", "allow");
    next = decideRuntimeWorkspaceCommand(next, "main", "NPM", "allow");
    const workspace = next.workspaces[0]!;
    expect(workspace.profile).toBe("coding");
    expect(workspace.tools).toEqual({ allow: [], deny: [], explicit: ["shell"] });
    expect(workspace.commands.allow).toEqual(["npm"]);
  });

  it("moves a tool between allow, deny, and inherited policy deterministically", () => {
    let next = decideRuntimeWorkspaceTool(baseConfig(), "main", "read_file", "allow");
    next = decideRuntimeWorkspaceTool(next, "main", "read_file", "deny");
    expect(next.workspaces[0]!.tools).toEqual({ allow: [], deny: ["read_file"], explicit: [] });
    next = decideRuntimeWorkspaceTool(next, "main", "read_file", "inherit");
    expect(next.workspaces[0]!.tools).toEqual({ allow: [], deny: [], explicit: [] });
  });

  it("rejects removal of the selected default Workspace", () => {
    expect(() => removeRuntimeWorkspace(baseConfig(), "main")).toThrowError(WorkspaceMutationError);
    try { removeRuntimeWorkspace(baseConfig(), "main"); }
    catch (error) { expect((error as WorkspaceMutationError).code).toBe("default_workspace_remove_forbidden"); }
  });
});
