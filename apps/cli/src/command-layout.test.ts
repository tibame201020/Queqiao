import { describe, expect, it } from "vitest";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { assertCommandOwnership, resolveCommandLayout } from "./command-layout.js";

describe("CLI ownership layout", () => {
  it("routes Worker-owned Workspace and policy commands to the named Worker config", () => {
    const expected = resolveRuntimeLayoutForNamedRole("worker", "windows").configFile;
    expect(resolveCommandLayout(["workspace", "list", "--worker", "windows"]).configFile).toBe(expected);
    expect(resolveCommandLayout(["profile", "set", "--worker", "windows"]).configFile).toBe(expected);
    expect(resolveCommandLayout(["tool", "allow", "--worker", "windows"]).configFile).toBe(expected);
    expect(resolveCommandLayout(["command", "allow", "--worker", "windows"]).configFile).toBe(expected);
    expect(resolveCommandLayout(["permissions", "show", "--worker", "windows"]).configFile).toBe(expected);
  });

  it.each([
    ["workspace", "add"],
    ["workspace", "list"],
    ["workspace", "remove"],
    ["profile", "set"],
    ["tool", "allow"],
    ["tool", "deny"],
    ["command", "allow"],
    ["command", "deny"],
    ["permissions", "show"],
  ])("rejects Worker-owned route %s %s without a named Worker", (domain, action) => {
    expect(() => assertCommandOwnership([domain, action])).toThrow(/--worker is required/);
  });

  it("rejects generic config-file overrides that could bypass role ownership", () => {
    expect(() => assertCommandOwnership(["workspace", "list", "--worker", "windows", "--file", "other.yaml"])).toThrow(/--file is not supported/);
  });

  it("keeps Gateway-owned Worker membership on the named Gateway config", () => {
    expect(resolveCommandLayout(["worker", "list", "--name", "stable"]).configFile).toBe(resolveRuntimeLayoutForNamedRole("gateway", "stable").configFile);
  });
});
