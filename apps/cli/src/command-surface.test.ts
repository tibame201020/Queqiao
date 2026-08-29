import { describe, expect, it } from "vitest";
import { CLI_LEAF_CONTRACTS, isCliHelpContext, isRemovedCliRoute, listCanonicalCliRoutes, normalizeCliArgs, parseCliLeafArguments, renderCliHelp, renderCliRouteError, renderRemovedSelectorError, validateCliArgs } from "./command-surface.js";
import { selectorRoleForCliArgs, withRoleSelector } from "./instance-selector.js";

type LeafContract = (typeof CLI_LEAF_CONTRACTS)[number];

const REQUIRED_SAMPLE_ARGS: Readonly<Record<string, readonly string[]>> = {
  "gateway workers update": ["--worker-id", "worker-1", "--endpoint", "http://127.0.0.1:7576/"],
  "gateway workers remove": ["--worker-id", "worker-1"],
  "worker workspace remove": ["--id", "workspace-1"],
  "worker workspace tool allow": ["--workspace", "workspace-1", "--tool", "read_file"],
  "worker workspace tool deny": ["--workspace", "workspace-1", "--tool", "read_file"],
  "worker workspace command allow": ["--workspace", "workspace-1", "--command", "git"],
  "worker workspace command deny": ["--workspace", "workspace-1", "--command", "git"],
};

function positionalSamples(contract: LeafContract): string[] {
  if (!contract.positionals) return [];
  if (contract.route === "extension install") return [".\\extension"];
  if (contract.route.startsWith("extension ")) return ["dev.queqiao.test"];
  if (contract.route === "doctor tool explain") return ["read_file"];
  return Array.from({ length: contract.positionals }, (_, index) => `arg-${index + 1}`);
}

function canonicalLeafInvocation(contract: LeafContract): string[] {
  let args = [...contract.route.split(" "), ...positionalSamples(contract), ...(REQUIRED_SAMPLE_ARGS[contract.route] || [])];
  const selectorRole = selectorRoleForCliArgs(args);
  if (selectorRole) args = withRoleSelector(args, selectorRole, selectorRole === "gateway" ? "stable" : "windows");
  return args;
}

describe("CLI hierarchy consolidation", () => {
  it.each([
    [["gateway", "workers", "list", "--gateway", "stable"], ["membership", "list", "--gateway", "stable"]],
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
    ["worker", "list"],
    ["gateway", "setup"],
    ["gateway", "serve", "--bg", "--gateway", "stable"],
    ["worker", "serve", "--bg", "--worker", "windows"],
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
    expect(renderCliHelp(["worker", "workspace", "--help"])).toContain("\n  add [--worker <worker>]");
    expect(renderCliHelp(["worker", "workspace", "--help"])).toContain("profile set --worker <worker> [--workspace <id>] [--profile read-only|editor|coding]");
    expect(renderCliHelp(["worker", "workspace", "--help"])).toContain("interactively applies an Access Profile");
    expect(renderCliHelp(["worker", "workspace", "--help"])).not.toContain("worker workspace add");
    expect(renderCliHelp(["extension", "--help"])).toContain("\n  install <npm:package|local-path>");
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

  it("freezes every public leaf in one parser contract", () => {
    expect(CLI_LEAF_CONTRACTS).toHaveLength(41);
    expect(new Set(CLI_LEAF_CONTRACTS.map(({ route }) => route)).size).toBe(CLI_LEAF_CONTRACTS.length);
    expect(CLI_LEAF_CONTRACTS.map(({ route }) => route).sort()).toEqual(listCanonicalCliRoutes());
  });

  it.each(CLI_LEAF_CONTRACTS)("accepts the canonical invocation for $route", (contract) => {
    const invocation = canonicalLeafInvocation(contract);
    expect(() => validateCliArgs(invocation)).not.toThrow();
  });

  it.each(CLI_LEAF_CONTRACTS)("keeps selector insertion option-safe for $route", (contract) => {
    const expectedPositionals = positionalSamples(contract);
    const base = [...contract.route.split(" "), ...expectedPositionals, ...(REQUIRED_SAMPLE_ARGS[contract.route] || [])];
    const selectorRole = selectorRoleForCliArgs(base);
    const invocation = selectorRole
      ? withRoleSelector(base, selectorRole, selectorRole === "gateway" ? "stable" : "windows")
      : base;
    expect(() => validateCliArgs(invocation)).not.toThrow();
    const parsed = parseCliLeafArguments(invocation);
    expect(parsed?.route).toBe(contract.route);
    expect(parsed?.positionals).toEqual(expectedPositionals);
    if (selectorRole) {
      const selectorIndex = invocation.indexOf(`--${selectorRole}`);
      expect(selectorIndex).toBeGreaterThanOrEqual(contract.route.split(" ").length);
      expect(invocation[selectorIndex + 1]).toBe(selectorRole === "gateway" ? "stable" : "windows");
      expect(parsed?.options[selectorRole]).toBe(selectorRole === "gateway" ? "stable" : "windows");
    }
  });

  it.each(CLI_LEAF_CONTRACTS)("renders leaf help for $route", (contract) => {
    const help = renderCliHelp([...contract.route.split(" "), "--help"]);
    expect(help).toContain("Usage: queqiao");
    expect(help).toContain(contract.route.split(" ")[0]!);
  });

  it("extracts extension positionals independently of option order", () => {
    const parsed = parseCliLeafArguments(["extension", "attach", "--worker", "wins-worker", "dev.queqiao.mcp"]);
    expect(parsed).toMatchObject({
      route: "extension attach",
      positionals: ["dev.queqiao.mcp"],
      options: { worker: "wins-worker" },
    });
  });

  it.each([
    [["gateway", "status", "--bogus"], /Unknown option "--bogus"/],
    [["worker", "serve", "--worker"], /requires a value/],
    [["extension", "list", "extra"], /Unexpected argument/],
    [["gateway", "--bogus"], /Unknown global option/],
    [["gateway", "workers", "update", "--worker-id", "w1"], /--endpoint is required/],
  ])("rejects malformed leaf arguments %j", (input, message) => {
    expect(() => validateCliArgs(input)).toThrow(message);
  });

  it("accepts global flags and documented leaf arguments", () => {
    expect(() => validateCliArgs(["--json", "gateway", "workers", "update", "--gateway", "stable", "--worker-id", "w1", "--endpoint", "http://127.0.0.1:7576/"])).not.toThrow();
  });

  it.each([
    [["gateway", "status", "--name", "stable"], "--gateway <name>"],
    [["worker", "status", "--name", "windows"], "--worker <name>"],
    [["worker", "workspace", "add", "--name", "Codes"], "--display-name <name>"],
  ])("provides one canonical replacement for removed selectors %j", (input, replacement) => {
    expect(renderRemovedSelectorError(input)).toContain(replacement);
  });
});
