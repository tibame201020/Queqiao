import { describe, expect, it } from "vitest";
import { isCliHelpContext, isRemovedCliRoute, normalizeCliArgs, renderCliHelp, renderCliRouteError } from "./command-surface.js";

describe("CLI hierarchy consolidation", () => {
  it.each([
    [["gateway", "workers", "list", "--name", "stable"], ["membership", "list", "--name", "stable"]],
    [["gateway", "workers", "update", "--worker-id", "w1", "--endpoint", "http://127.0.0.1:7576/"], ["membership", "update", "--worker-id", "w1", "--endpoint", "http://127.0.0.1:7576/"]],
    [["gateway", "workers", "remove", "--worker-id", "w1"], ["membership", "remove", "--worker-id", "w1"]],
    [["worker", "workspace", "add", "--worker", "windows"], ["workspace", "add", "--worker", "windows"]],
    [["worker", "workspace", "list", "--worker", "windows"], ["workspace", "list", "--worker", "windows"]],
    [["worker", "workspace", "remove", "--worker", "windows", "--id", "codes"], ["workspace", "remove", "--worker", "windows", "--id", "codes"]],
    [["worker", "workspace", "profile", "set", "--worker", "windows", "--workspace", "codes", "--profile", "coding"], ["profile", "set", "--worker", "windows", "--workspace", "codes", "--profile", "coding"]],
    [["worker", "workspace", "tool", "allow", "--worker", "windows", "--workspace", "codes", "--tool", "shell"], ["tool", "allow", "--worker", "windows", "--workspace", "codes", "--tool", "shell"]],
    [["worker", "workspace", "command", "allow", "--worker", "windows", "--workspace", "codes", "--command", "git"], ["command", "allow", "--worker", "windows", "--workspace", "codes", "--command", "git"]],
    [["worker", "workspace", "permissions", "show", "--worker", "windows"], ["permissions", "show", "--worker", "windows"]],
    [["doctor", "extension"], ["extension", "doctor"]],
    [["doctor", "manifest", "show"], ["manifest", "show"]],
    [["doctor", "tool", "explain", "shell"], ["tool", "explain", "shell"]],
    [["doctor", "paths"], ["config", "paths"]],
  ])("maps canonical %j to the existing handler route", (input, expected) => {
    expect(normalizeCliArgs(input)).toEqual(expected);
  });

  it.each([
    [["worker", "list"], "queqiao gateway workers list"],
    [["worker", "update"], "queqiao gateway workers update"],
    [["workspace", "add"], "queqiao worker workspace add"],
    [["workspace", "list"], "queqiao worker workspace list"],
    [["workspace", "remove"], "queqiao worker workspace remove"],
    [["profile", "set"], "queqiao worker workspace profile set"],
    [["tool", "allow"], "queqiao worker workspace tool allow"],
    [["tool", "deny"], "queqiao worker workspace tool deny"],
    [["command", "allow"], "queqiao worker workspace command allow"],
    [["command", "deny"], "queqiao worker workspace command deny"],
    [["permissions", "show"], "queqiao worker workspace permissions show"],
    [["extension", "doctor"], "queqiao doctor extension"],
    [["manifest", "show"], "queqiao doctor manifest show --gateway <name>"],
    [["tool", "explain"], "queqiao doctor tool explain <tool> --gateway <name>"],
    [["config", "paths"], "queqiao doctor paths"],
  ])("rejects removed flat route %j", (input, replacement) => {
    const normalized = normalizeCliArgs(input);
    expect(isRemovedCliRoute(normalized)).toBe(true);
    expect(normalized[1]).toContain(replacement);
  });

  it.each([
    ["gateway", "setup"],
    ["gateway", "serve", "--bg", "--name", "stable"],
    ["worker", "serve", "--bg", "--name", "windows"],
    ["extension", "install", "npm:queqiao-mcp", "--worker", "windows"],
  ])("preserves unchanged canonical route %j", (...input) => {
    expect(normalizeCliArgs(input)).toEqual(input);
  });

  it("keeps the root mental model limited to Gateway, Worker, Extension, and Doctor", () => {
    const help = renderCliHelp([]);
    expect(help).toContain("gateway");
    expect(help).toContain("worker");
    expect(help).toContain("extension");
    expect(help).toContain("doctor");
    expect(help).toContain("uninstall");
    expect(help).not.toMatch(/^\s{2}(workspace|profile|tool|command|permissions|discovery|manifest|config|migrate)\b/m);
  });

  it("documents only the converged enrollment surface", () => {
    const tokenHelp = renderCliHelp(["gateway", "join-token", "--help"]);
    expect(tokenHelp).toContain("--expires <seconds>");
    expect(tokenHelp).not.toContain("--worker-id");
    expect(tokenHelp).not.toContain("--environment-id");
    const joinHelp = renderCliHelp(["worker", "join", "--help"]);
    expect(joinHelp).toContain("--join-code <code>");
    expect(joinHelp).not.toContain("--gateway");
    expect(joinHelp).not.toContain("--token");
    expect(joinHelp).not.toContain("--endpoint");
  });

  it("does not expose the obsolete generic discovery-root resource", () => {
    expect(renderCliHelp(["worker", "--help"])).not.toContain("discovery");
    expect(renderCliHelp(["worker", "discovery", "--help"])).not.toContain("worker discovery");
  });

  it("rejects the removed default Workspace route instead of recognizing a handlerless command", () => {
    expect(renderCliRouteError(["worker", "workspace", "default", "set"])).toContain('Unknown command "default"');
  });

  it("renders scoped help using commands relative to the current context", () => {
    expect(renderCliHelp(["gateway", "--help"])).toContain("\n  setup\n");
    expect(renderCliHelp(["gateway", "--help"])).toContain("\n  remove\n");
    expect(renderCliHelp(["gateway", "--help"])).not.toContain("\n  gateway setup\n");
    expect(renderCliHelp(["gateway", "workers", "--help"])).toContain("\n  list\n");
    expect(renderCliHelp(["gateway", "workers", "--help"])).not.toContain("gateway workers list");
    expect(renderCliHelp(["worker", "--help"])).toContain("\n  remove\n");
    expect(renderCliHelp(["worker", "workspace", "--help"])).toContain("\n  add --worker <worker>\n");
    expect(renderCliHelp(["worker", "workspace", "--help"])).toContain("profile set --worker <worker> [--workspace <id>] [--profile read-only|editor|coding]");
    expect(renderCliHelp(["worker", "workspace", "--help"])).toContain("interactively applies an Access Profile");
    expect(renderCliHelp(["worker", "workspace", "--help"])).not.toContain("worker workspace add");
    expect(renderCliHelp(["extension", "--help"])).toContain("\n  install npm:<package>");
    expect(renderCliHelp(["extension", "--help"])).not.toContain("extension install");
    expect(renderCliHelp(["doctor", "--help"])).toContain("\n  extension\n");
    expect(renderCliHelp(["uninstall", "--help"])).toContain("Usage: queqiao uninstall");
    expect(renderCliHelp(["uninstall", "--help"])).not.toContain("--yes");
    expect(renderCliHelp(["workspace", "--help"])).toBe(renderCliHelp([]));
  });

  it.each([
    [["gateway"], true],
    [["gateway", "workers"], true],
    [["worker"], true],
    [["worker", "workspace"], true],
    [["extension"], true],
    [["gateway", "status"], false],
    [["doctor"], false],
  ])("detects implicit help context %j", (input, expected) => {
    expect(isCliHelpContext(input)).toBe(expected);
  });
});
