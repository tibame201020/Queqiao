import { describe, expect, it } from "vitest";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { assertCommandOwnership, resolveCommandLayout } from "./command-layout.js";

describe("CLI ownership layout", () => {
  it("routes every Worker-owned Workspace CRUD command to the named Worker config", () => {
    const expected = resolveRuntimeLayoutForNamedRole("worker", "windows").configFile;
    for (const action of ["add", "list", "info", "edit", "remove"]) {
      expect(resolveCommandLayout(["workspace", action, "--worker", "windows"]).configFile).toBe(expected);
    }
  });

  it.each(["add", "list", "info", "edit", "remove"])("rejects Worker-owned Workspace %s without a named Worker", (action) => {
    expect(() => assertCommandOwnership(["workspace", action])).toThrow(/--worker is required/);
  });

  it("keeps Access Profile storage global instead of pretending profiles belong to a Worker", () => {
    expect(() => assertCommandOwnership(["profiles", "list"])).not.toThrow();
    expect(() => assertCommandOwnership(["profiles", "edit", "--profile", "safe"])).not.toThrow();
  });

  it("requires an explicit named role for enrollment commands", () => {
    expect(() => assertCommandOwnership(["gateway", "join-token"])).toThrow(/--gateway is required/);
    expect(() => assertCommandOwnership(["worker", "join"])).toThrow(/--worker is required/);
    expect(() => assertCommandOwnership(["gateway", "join-token", "--gateway", "stable"])).not.toThrow();
    expect(() => assertCommandOwnership(["worker", "join", "--worker", "wins-worker"])).not.toThrow();
  });

  it("rejects generic config-file overrides that could bypass role ownership", () => {
    expect(() => assertCommandOwnership(["workspace", "list", "--worker", "windows", "--file", "other.yaml"])).toThrow(/--file is not supported/);
  });

  it("keeps Gateway-owned Worker membership on the named Gateway config", () => {
    expect(resolveCommandLayout(["membership", "list", "--gateway", "stable"]).configFile).toBe(resolveRuntimeLayoutForNamedRole("gateway", "stable").configFile);
  });

  it("routes Gateway-owned manifest and tool diagnostics to an explicit named Gateway", () => {
    const expected = resolveRuntimeLayoutForNamedRole("gateway", "stable").configFile;
    expect(resolveCommandLayout(["manifest", "show", "--gateway", "stable"]).configFile).toBe(expected);
    expect(resolveCommandLayout(["tool", "explain", "shell", "--gateway", "stable"]).configFile).toBe(expected);
  });

  it("rejects Gateway-owned manifest and tool diagnostics without a named Gateway", () => {
    expect(() => assertCommandOwnership(["manifest", "show"])).toThrow(/--gateway is required/);
    expect(() => assertCommandOwnership(["tool", "explain", "shell"])).toThrow(/--gateway is required/);
  });
});
