import { describe, expect, it } from "vitest";
import {
  accessConfigurationToWorkspacePolicy,
  normalizeAllowedExecutables,
  normalizeCommandHistory,
} from "./access-configuration.js";

describe("access configuration", () => {
  it("normalizes comma-separated executables without duplicate entries", () => {
    expect(normalizeAllowedExecutables(" git, NPM , node,git ,, npm ")).toEqual(["git", "npm", "node"]);
  });

  it("drops command policy when run is not selected", () => {
    expect(accessConfigurationToWorkspacePolicy({
      tools: ["read_file", "write_file", "shell"],
      allowedExecutables: ["git", "npm"],
    })).toEqual({
      profile: "coding",
      tools: { allow: ["read_file", "write_file", "shell"], deny: [], explicit: ["shell"] },
      commands: { allow: [] },
    });
  });

  it("keeps the legacy profile field permissive so the explicit tool matrix is authoritative", () => {
    expect(accessConfigurationToWorkspacePolicy({ tools: ["read_file", "search_text"], allowedExecutables: [] }).profile).toBe("coding");
    expect(accessConfigurationToWorkspacePolicy({ tools: ["read_file", "edit_file"], allowedExecutables: [] }).profile).toBe("coding");
    expect(accessConfigurationToWorkspacePolicy({ tools: ["read_file", "run"], allowedExecutables: ["git"] }).profile).toBe("coding");
  });

  it("keeps newest distinct command text first in bounded history", () => {
    expect(normalizeCommandHistory(["git, npm", "node", "git, npm", "python"], 3)).toEqual(["git, npm", "node", "python"]);
  });
});
