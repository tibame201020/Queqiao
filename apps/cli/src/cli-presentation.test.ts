import { stripVTControlCharacters } from "node:util";
import { describe, expect, it } from "vitest";
import { renderCliRouteError } from "./command-surface.js";
import { formatCliOutput } from "./cli-output.js";

describe("CLI presentation", () => {
  it("suggests a nearby command within the current command context", () => {
    expect(renderCliRouteError(["gateway", "stas"])).toBe([
      'Unknown command "stas" for "queqiao gateway".',
      "",
      "Did you mean this?",
      "  status",
      "",
      'Run "queqiao gateway --help" for available commands.',
    ].join("\n"));
  });

  it.each([
    [["g"], "gateway"],
    [["w"], "worker"],
    [["e"], "extension"],
    [["ex"], "extension"],
    [["extens"], "extension"],
  ])("suggests a unique command prefix %j", (input, expected) => {
    expect(renderCliRouteError(input)).toContain(`  ${expected}`);
  });

  it("lists all matching commands for an ambiguous prefix instead of choosing arbitrarily", () => {
    const message = renderCliRouteError(["gateway", "st"]);
    expect(message).toContain("Did you mean one of these?");
    expect(message).toContain("  status");
    expect(message).toContain("  stop");
  });

  it("lists all local prefix matches for a short ambiguous prefix", () => {
    const message = renderCliRouteError(["gateway", "s"]);
    for (const candidate of ["serve", "setup", "status", "stop"]) {
      expect(message).toContain(`  ${candidate}`);
    }
  });

  it("keeps a low-confidence unrelated input suggestion-free", () => {
    const message = renderCliRouteError(["gateway", "nonesuch"]);
    expect(message).not.toContain("Did you mean");
  });

  it("keeps unknown-command errors local instead of dumping root usage", () => {
    const message = renderCliRouteError(["gateway", "nonesuch"]);
    expect(message).toContain('Unknown command "nonesuch" for "queqiao gateway".');
    expect(message).toContain('Run "queqiao gateway --help"');
    expect(message).not.toContain("worker workspace");
    expect(message).not.toContain("Usage: queqiao <command>");
  });

  it("renders an unconfigured Gateway status for humans", () => {
    const output = formatCliOutput(["gateway", "status", "--gateway", "stable"], {
      name: "stable",
      role: "gateway",
      active: false,
      managed: false,
      health: {
        reachable: false,
        healthy: false,
        identityMatches: false,
        error: "Gateway is not configured",
      },
    });
    expect(output).toBe([
      "Gateway stable",
      "  Status: Not configured",
      "  Managed: No",
      "",
      "Next",
      "  queqiao gateway setup",
    ].join("\n"));
  });

  it("renders a running Worker status for humans", () => {
    const output = formatCliOutput(["worker", "status", "--worker", "windows"], {
      name: "windows",
      role: "worker",
      active: true,
      managed: true,
      pid: 1234,
      health: { reachable: true, healthy: true, identityMatches: true, status: 200 },
    });
    expect(output).toContain("Worker windows");
    expect(output).toContain("Status: Running");
    expect(output).toContain("Managed: Yes");
    expect(output).toContain("PID: 1234");
    expect(output).not.toContain("{");
  });

  it("renders join-token as a short-lived handoff with the next Worker step", () => {
    const output = formatCliOutput(["gateway", "join-token", "--gateway", "stable"], {
      copied: true,
      joinCodeVersion: 1,
      expiresAt: "2026-08-28T14:30:00.000Z",
      bindings: [],
    });
    expect(output).toBe([
      "✓ Join code copied to clipboard",
      "  Expires At: 2026-08-28T14:30:00.000Z",
      "",
      "Next",
      "  Before expiry, on the target Worker host:",
      "  queqiao worker join --worker <worker>",
    ].join("\n"));
  });

  it("shows the join code when clipboard copy is unavailable", () => {
    const output = formatCliOutput(["gateway", "join-token", "--gateway", "stable"], {
      copied: false,
      joinCodeVersion: 1,
      expiresAt: "2026-08-28T14:30:00.000Z",
      joinCode: "qjq1:test-code",
      copyError: "Clipboard unavailable",
      bindings: [],
    });
    expect(output).toContain("Join code could not be copied");
    expect(output).toContain("qjq1:test-code");
    expect(output).toContain("queqiao worker join --worker <worker>");
  });

  it("renders a successful Worker join as an operation result", () => {
    const output = formatCliOutput(["worker", "join", "--worker", "wins-worker"], { joined: true, workerId: "worker-1", environmentId: "windows" });
    expect(output).toBe([
      "✓ Worker joined Gateway: wins-worker",
      "  Worker Id: worker-1",
      "  Environment Id: windows",
    ].join("\n"));
  });

  it("adds structural color without changing human-readable content", () => {
    const colored = formatCliOutput(["gateway", "list"], {
      instances: [{
        name: "stable",
        configured: true,
        running: true,
        managed: true,
        publicUrl: "https://gateway.example/stable/",
        servicePort: 8075,
        managementPort: 8074,
      }],
    }, { color: true });
    const plain = stripVTControlCharacters(colored);
    expect(plain).toContain("Gateways");
    expect(plain).toContain("stable  Running");
    expect(plain).toContain("URL: https://gateway.example/stable/");
    expect(colored).not.toBe(plain);
  });

  it("renders Extension Hub inventory as a CLI hierarchy instead of a raw object dump", () => {
    const output = formatCliOutput(["extension", "list"], {
      hub: "C:/Users/test/AppData/Local/Queqiao/data/extensions",
      extensions: [{
        id: "dev.queqiao.mcp",
        displayName: "Queqiao MCP Adapter",
        version: "0.1.0",
        package: "queqiao-mcp",
        workers: [
          { name: "windows", attached: false },
          { name: "wins-worker", attached: true },
        ],
      }],
    });
    expect(output).toBe([
      "Extensions",
      "  Hub: C:/Users/test/AppData/Local/Queqiao/data/extensions",
      "",
      "  Queqiao MCP Adapter  0.1.0",
      "    Id: dev.queqiao.mcp",
      "    Package: queqiao-mcp",
      "    Workers:",
      "      windows  Detached",
      "      wins-worker  Attached",
    ].join("\n"));
    expect(output).not.toContain("  -");
  });

  it("renders Gateway connector info as copy-friendly blocks without revealing the secret by default", () => {
    const output = formatCliOutput(["gateway", "info", "--gateway", "stable"], {
      schemaVersion: "1.0",
      gateway: "stable",
      mcpUrl: "https://gateway.example/stable/mcp",
      publicBaseUrl: "https://gateway.example/stable/",
      authentication: "OAuth 2.0 Authorization Code + PKCE",
      approvalSecretAvailable: true,
    });
    expect(output).toBe([
      "Gateway stable",
      "",
      "Connector",
      "  MCP URL",
      "  https://gateway.example/stable/mcp",
      "",
      "  Approval secret",
      "  Hidden - use --detail to reveal or --copy-secret to copy",
      "",
      "Authentication",
      "  OAuth 2.0 Authorization Code + PKCE",
    ].join("\n"));
    expect(output).not.toContain("owner-secret");
  });

  it("renders detail mode with an independently selectable approval secret", () => {
    const output = formatCliOutput(["gateway", "info", "--gateway", "stable", "--detail"], {
      schemaVersion: "1.0",
      gateway: "stable",
      mcpUrl: "https://gateway.example/stable/mcp",
      publicBaseUrl: "https://gateway.example/stable/",
      authentication: "OAuth 2.0 Authorization Code + PKCE",
      approvalSecretAvailable: true,
      approvalSecret: "owner-secret",
      running: true,
      managed: true,
      servicePort: 8075,
      managementPort: 8074,
      allowedRedirectOrigins: ["https://chatgpt.com"],
    });
    expect(output).toContain("  https://gateway.example/stable/mcp\n");
    expect(output).toContain("  owner-secret\n");
    expect(output).toContain("Status: Running");
    expect(output).toContain("Redirect origins:");
  });

  it("renders Gateway info clipboard actions without echoing copied values", () => {
    const output = formatCliOutput(["gateway", "info", "--gateway", "stable", "--copy-secret"], {
      gateway: "stable",
      copied: "approval-secret",
    });
    expect(output).toBe("✓ Approval secret copied to clipboard\n  Gateway: stable");
    expect(output).not.toContain("owner-secret");
  });

  it("preserves structured output behind --json", () => {
    const value = { name: "stable", role: "gateway", active: false };
    expect(formatCliOutput(["gateway", "status", "--gateway", "stable", "--json"], value)).toBe(JSON.stringify(value, null, 2));
  });
});
