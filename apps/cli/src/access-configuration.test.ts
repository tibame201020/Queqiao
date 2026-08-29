import { describe, expect, it } from "vitest";
import {
  ACCESS_TOOL_OPTIONS,
  BUILTIN_ACCESS_PROFILES,
  accessConfigurationToWorkspacePolicy,
  formatBuiltinAccessProfileLabel,
  renderAccessToolOption,
  normalizeAllowedExecutables,
  normalizeCommandHistory,
} from "./access-configuration.js";

describe("access configuration", () => {
  it("exposes Reader and Editor as built-in reusable access profiles", () => {
    expect(BUILTIN_ACCESS_PROFILES.map((profile) => profile.name)).toEqual(["Reader", "Editor"]);
    expect(BUILTIN_ACCESS_PROFILES[0]?.configuration.tools).toEqual(expect.arrayContaining(["read_file", "search_text"]));
    expect(BUILTIN_ACCESS_PROFILES[1]?.configuration.tools).toEqual(expect.arrayContaining(["read_file", "write_file", "edit_file"]));
    expect(BUILTIN_ACCESS_PROFILES[1]?.configuration.tools).not.toContain("run");
    expect(BUILTIN_ACCESS_PROFILES[1]?.configuration.tools).not.toContain("shell");
  });

  it("keeps inactive tool descriptions dim but makes selected tool descriptions bright", () => {
    const readFile = ACCESS_TOOL_OPTIONS.find((option) => option.value === "read_file")!;
    expect(renderAccessToolOption(readFile, false, false)).toContain("\x1b[2mRead text file");
    expect(renderAccessToolOption(readFile, true, false)).not.toContain("\x1b[2mRead text file");
    expect(renderAccessToolOption(readFile, false, true)).not.toContain("\x1b[2mRead text file");
  });

  it("describes built-in profiles with their concrete tool sets", () => {
    const reader = BUILTIN_ACCESS_PROFILES[0]!;
    const editor = BUILTIN_ACCESS_PROFILES[1]!;
    expect(formatBuiltinAccessProfileLabel(reader)).toContain("Reader");
    expect(formatBuiltinAccessProfileLabel(reader)).toContain("read_file");
    expect(formatBuiltinAccessProfileLabel(reader)).toContain("\x1b[2m");
    expect(formatBuiltinAccessProfileLabel(editor)).toContain("write_file");
    expect(formatBuiltinAccessProfileLabel(editor)).toContain("edit_file");
  });

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
