import { createQueqiaoTheme, TUI_GLYPHS, type QueqiaoTheme } from "./tui-theme.js";

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function label(value: string): string {
  const spaced = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function scalar(value: unknown): string {
  if (value === true) return "Yes";
  if (value === false) return "No";
  if (value === null || value === undefined || value === "") return "-";
  return String(value);
}

function structuralValue(theme: QueqiaoTheme, key: string, value: unknown): string {
  const text = scalar(value);
  if (/url|endpoint|path|file|directory|hub|root|module/i.test(key)) return theme.link(text);
  if (/(^|\s)id$/i.test(key) || /name$/i.test(key)) return theme.identifier(text);
  return theme.value(text);
}

function field(theme: QueqiaoTheme, key: string, value: unknown, indent = 0): string {
  return `${" ".repeat(indent)}${theme.subtle(`${key}:`)} ${structuralValue(theme, key, value)}`;
}

function renderStructured(value: unknown, theme: QueqiaoTheme, indent = 0): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}${theme.muted("None")}`];
    const lines: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        lines.push(`${pad}${theme.subtle("-")}`);
        lines.push(...renderStructured(item, theme, indent + 2));
      } else {
        lines.push(`${pad}${theme.subtle("-")} ${theme.value(scalar(item))}`);
      }
    }
    return lines;
  }
  if (value && typeof value === "object") {
    const lines: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child && typeof child === "object") {
        lines.push(`${pad}${theme.subtle(`${label(key)}:`)}`);
        lines.push(...renderStructured(child, theme, indent + 2));
      } else {
        lines.push(field(theme, label(key), child, indent));
      }
    }
    return lines;
  }
  return [`${pad}${theme.value(scalar(value))}`];
}

function isNotConfigured(role: string, health: Record<string, unknown>): boolean {
  const error = typeof health.error === "string" ? health.error : "";
  return error === `${role} is not configured` || (/ENOENT/.test(error) && /config\.yaml/.test(error));
}

function renderRoleInventory(args: readonly string[], value: unknown, theme: QueqiaoTheme): string | undefined {
  if (!((args[0] === "gateway" || args[0] === "worker") && args[1] === "list")) return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.instances)) return undefined;
  const heading = args[0] === "gateway" ? "Gateways" : "Workers";
  if (!result.instances.length) return `${theme.accentStrong(heading)}\n  ${theme.muted("None")}`;
  const lines = [theme.accentStrong(heading)];
  for (const item of result.instances) {
    const instance = item as Record<string, unknown>;
    const status = instance.running === true
      ? theme.success("Running")
      : instance.configured === false
        ? theme.danger("Invalid configuration")
        : theme.muted("Stopped");
    lines.push(`  ${theme.identifier(scalar(instance.name))}  ${status}`);
    if (args[0] === "gateway") {
      lines.push(field(theme, "URL", instance.publicUrl, 4));
      lines.push(field(theme, "Ports", `${scalar(instance.servicePort)} / management ${scalar(instance.managementPort)}`, 4));
    } else {
      lines.push(field(theme, "Endpoint", instance.endpoint, 4));
      lines.push(field(theme, "Workspaces", instance.workspaceCount, 4));
    }
  }
  return lines.join("\n");
}

function renderExtensionInventory(args: readonly string[], value: unknown, theme: QueqiaoTheme): string | undefined {
  if (args[0] !== "extension" || args[1] !== "list") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.extensions)) return undefined;

  const lines = [theme.accentStrong("Extensions")];
  if (typeof result.hub === "string") lines.push(field(theme, "Hub", result.hub, 2));
  if (!result.extensions.length) {
    lines.push(`  ${theme.muted("None")}`);
    return lines.join("\n");
  }

  for (const item of result.extensions) {
    if (!item || typeof item !== "object") continue;
    const extension = item as Record<string, unknown>;
    const displayName = typeof extension.displayName === "string" && extension.displayName
      ? extension.displayName
      : scalar(extension.id);
    const version = scalar(extension.version);
    lines.push("", `  ${theme.identifier(displayName)}  ${theme.muted(version)}`);
    lines.push(field(theme, "Id", extension.id, 4));
    lines.push(field(theme, "Package", extension.package, 4));
    if (Array.isArray(extension.workers)) {
      lines.push(`${theme.subtle("    Workers:")}`);
      if (!extension.workers.length) {
        lines.push(`      ${theme.muted("None")}`);
      } else {
        for (const workerItem of extension.workers) {
          if (!workerItem || typeof workerItem !== "object") continue;
          const worker = workerItem as Record<string, unknown>;
          const workerName = scalar(worker.name);
          const attachment = worker.attached === true ? theme.success("Attached") : theme.muted("Detached");
          lines.push(`      ${theme.identifier(workerName)}  ${attachment}`);
        }
      }
    }
  }
  return lines.join("\n");
}

function renderJoinToken(args: readonly string[], value: unknown, theme: QueqiaoTheme): string | undefined {
  if (args[0] !== "gateway" || args[1] !== "join-token") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const expiresAt = typeof result.expiresAt === "string" ? result.expiresAt : "unknown";
  const copied = result.copied === true;
  const lines: string[] = [];

  if (copied) {
    lines.push(`${theme.success(TUI_GLYPHS.success)} ${theme.strong("Join code copied to clipboard")}`, field(theme, "Expires At", expiresAt, 2));
  } else {
    lines.push(`${theme.warning(TUI_GLYPHS.warning)} ${theme.strong("Join code could not be copied")}`, field(theme, "Expires At", expiresAt, 2));
    if (typeof result.joinCode === "string" && result.joinCode) {
      lines.push("", theme.accentStrong("Join code"), `  ${theme.code(result.joinCode)}`);
    }
    if (typeof result.copyError === "string" && result.copyError) lines.push(field(theme, "Copy Error", result.copyError, 2));
  }

  lines.push("", theme.accentStrong("Next"), theme.muted("  Before expiry, on the target Worker host:"), `  ${theme.code("queqiao worker join --worker <worker>")}`);
  return lines.join("\n");
}

function renderWorkerJoin(args: readonly string[], value: unknown, theme: QueqiaoTheme): string | undefined {
  if (args[0] !== "worker" || args[1] !== "join") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (result.joined !== true) return undefined;
  const name = option(args, "worker") || "worker";
  const lines = [`${theme.success(TUI_GLYPHS.success)} ${theme.strong("Worker joined Gateway:")} ${theme.identifier(name)}`];
  if (typeof result.workerId === "string") lines.push(field(theme, "Worker Id", result.workerId, 2));
  if (typeof result.environmentId === "string") lines.push(field(theme, "Environment Id", result.environmentId, 2));
  return lines.join("\n");
}

function renderGatewayInfo(args: readonly string[], value: unknown, theme: QueqiaoTheme): string | undefined {
  if (args[0] !== "gateway" || args[1] !== "info") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const gateway = scalar(result.gateway);
  const copied = result.copied;
  if (copied === "mcp-url" || copied === "approval-secret") {
    const label = copied === "mcp-url" ? "MCP URL" : "Approval secret";
    return `${theme.success(TUI_GLYPHS.success)} ${theme.strong(`${label} copied to clipboard`)}\n${field(theme, "Gateway", gateway, 2)}`;
  }

  const detail = args.includes("--detail");
  const lines = [
    `${theme.strong("Gateway")} ${theme.identifier(gateway)}`,
    "",
    theme.accentStrong("Connector"),
    theme.subtle("  MCP URL"),
    `  ${theme.link(scalar(result.mcpUrl))}`,
    "",
    theme.subtle("  Approval secret"),
  ];
  if (detail && typeof result.approvalSecret === "string") lines.push(`  ${theme.code(result.approvalSecret)}`);
  else if (result.approvalSecretAvailable === true) lines.push(`  ${theme.muted("Hidden - use --detail to reveal or --copy-secret to copy")}`);
  else lines.push(`  ${theme.warning("Unavailable")}`);

  lines.push("", theme.accentStrong("Authentication"), `  ${theme.value(scalar(result.authentication))}`);
  if (detail) {
    lines.push(
      "",
      theme.accentStrong("Gateway details"),
      field(theme, "Public URL", result.publicBaseUrl, 2),
      field(theme, "Status", result.running === true ? "Running" : "Stopped", 2),
      field(theme, "Managed", result.managed === true ? "Yes" : "No", 2),
      field(theme, "Service Port", result.servicePort, 2),
      field(theme, "Management Port", result.managementPort, 2),
    );
    if (Array.isArray(result.allowedRedirectOrigins)) {
      lines.push(`${theme.subtle("  Redirect origins:")}`);
      for (const origin of result.allowedRedirectOrigins) lines.push(`    ${theme.link(scalar(origin))}`);
    }
  }
  return lines.join("\n");
}
function renderWorkspaceManagement(args: readonly string[], value: unknown, theme: QueqiaoTheme): string | undefined {
  if (args[0] !== "worker" || args[1] !== "workspace" || !value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;

  if (Array.isArray(result.workspaces)) {
    const lines = [theme.accentStrong("Workspaces")];
    if (!result.workspaces.length) return `${lines[0]}\n  ${theme.muted("None")}`;
    for (const item of result.workspaces) {
      if (!item || typeof item !== "object") continue;
      const workspace = item as Record<string, unknown>;
      const access = workspace.access && typeof workspace.access === "object" ? workspace.access as Record<string, unknown> : {};
      lines.push("", `  ${theme.identifier(scalar(workspace.displayName))}`);
      lines.push(field(theme, "Root", workspace.root, 4));
      lines.push(field(theme, "Id", workspace.id, 4));
      lines.push(field(theme, "Access", access.mode === "legacy-wildcard" ? "Legacy policy" : "Explicit tools", 4));
    }
    return lines.join("\n");
  }

  if (Array.isArray(result.profiles)) {
    const lines = [theme.accentStrong("Access Profiles")];
    for (const item of result.profiles) {
      if (!item || typeof item !== "object") continue;
      const profile = item as Record<string, unknown>;
      const kind = profile.builtin === true ? theme.muted("Built-in") : theme.success("Custom");
      lines.push("", `  ${theme.identifier(scalar(profile.name))}  ${kind}`);
      const tools = Array.isArray(profile.tools) ? profile.tools : [];
      const commands = Array.isArray(profile.allowedExecutables) ? profile.allowedExecutables : [];
      lines.push(field(theme, "Tools", tools.length ? tools.join(", ") : "None", 4));
      if (commands.length) lines.push(field(theme, "Commands", commands.join(", "), 4));
    }
    lines.push("", theme.muted("Profiles are reusable templates; existing Workspaces are not live-linked."));
    return lines.join("\n");
  }

  if (result.workspace && typeof result.workspace === "object") {
    const workspace = result.workspace as Record<string, unknown>;
    const access = workspace.access && typeof workspace.access === "object" ? workspace.access as Record<string, unknown> : {};
    const lines = [
      `${theme.strong("Workspace")} ${theme.identifier(scalar(workspace.displayName))}`,
      field(theme, "Root", workspace.root, 2),
      field(theme, "Id", workspace.id, 2),
      "",
      theme.accentStrong("Access"),
      field(theme, "Mode", access.mode === "legacy-wildcard" ? "Legacy wildcard within capability ceiling" : "Explicit tools", 2),
      field(theme, "Capability ceiling", access.capabilityCeiling, 2),
    ];
    const tools = Array.isArray(access.tools) ? access.tools.join(", ") : scalar(access.tools);
    lines.push(field(theme, "Tools", tools || "None", 2));
    const explicit = Array.isArray(access.explicitTools) ? access.explicitTools : [];
    const denied = Array.isArray(access.deniedTools) ? access.deniedTools : [];
    const commands = Array.isArray(access.allowedExecutables) ? access.allowedExecutables : [];
    if (explicit.length) lines.push(field(theme, "Explicit tools", explicit.join(", "), 2));
    if (denied.length) lines.push(field(theme, "Denied tools", denied.join(", "), 2));
    lines.push(field(theme, "Allowed executables", commands.length ? commands.join(", ") : "None", 2));
    return lines.join("\n");
  }

  if (result.profile && typeof result.profile === "object") {
    const profile = result.profile as Record<string, unknown>;
    const tools = Array.isArray(profile.tools) ? profile.tools : [];
    const commands = Array.isArray(profile.allowedExecutables) ? profile.allowedExecutables : [];
    const lines = [
      `${theme.strong("Access Profile")} ${theme.identifier(scalar(profile.name))}`,
      field(theme, "Type", profile.builtin === true ? "Built-in" : "Custom", 2),
      field(theme, "Tools", tools.length ? tools.join(", ") : "None", 2),
      field(theme, "Allowed executables", commands.length ? commands.join(", ") : "None", 2),
      "",
      theme.muted("Applying this profile copies its policy to a Workspace; later profile changes do not modify existing Workspaces."),
    ];
    return lines.join("\n");
  }

  return undefined;
}
function renderStatus(args: readonly string[], value: unknown, theme: QueqiaoTheme): string | undefined {
  const [role, action] = args;
  if ((role !== "gateway" && role !== "worker") || action !== "status") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const selector = role === "gateway" ? "gateway" : "worker";
  const name = typeof result.name === "string" ? result.name : option(args, selector) || "unknown";
  const health = result.health && typeof result.health === "object" ? result.health as Record<string, unknown> : {};
  const roleLabel = role === "gateway" ? "Gateway" : "Worker";
  const configured = !isNotConfigured(roleLabel, health) && !isNotConfigured(role, health);
  const active = result.active === true;
  const managed = result.managed === true;
  const status = !configured ? theme.warning("Not configured") : active ? theme.success("Running") : theme.muted("Stopped");
  const lines = [
    `${theme.strong(roleLabel)} ${theme.identifier(name)}`,
    `${theme.subtle("  Status:")} ${status}`,
    field(theme, "Managed", managed ? "Yes" : "No", 2),
  ];
  if (typeof result.pid === "number") lines.push(field(theme, "PID", result.pid, 2));
  if (configured && !active) {
    const error = typeof health.error === "string" ? health.error : "";
    if (error) lines.push(field(theme, "Detail", error, 2));
  }
  if (!configured) {
    lines.push("", theme.accentStrong("Next"), `  ${theme.code(`queqiao ${role} setup`)}`);
  } else if (!active) {
    lines.push("", theme.accentStrong("Next"), `  ${theme.code(`queqiao ${role} serve --bg --${selector} ${name}`)}`);
  }
  return lines.join("\n");
}

export type CliOutputOptions = {
  color?: boolean;
};

export function formatCliOutput(input: readonly string[], value: unknown, options: CliOutputOptions = {}): string {
  if (input.includes("--json")) return JSON.stringify(value, null, 2);
  const theme = createQueqiaoTheme(options.color ?? false);
  const args = input.filter((arg) => arg !== "--json");
  const inventory = renderRoleInventory(args, value, theme);
  if (inventory) return inventory;
  const extensionInventory = renderExtensionInventory(args, value, theme);
  if (extensionInventory) return extensionInventory;
  const joinToken = renderJoinToken(args, value, theme);
  if (joinToken) return joinToken;
  const workerJoin = renderWorkerJoin(args, value, theme);
  if (workerJoin) return workerJoin;
  const gatewayInfo = renderGatewayInfo(args, value, theme);
  if (gatewayInfo) return gatewayInfo;
  const workspaceManagement = renderWorkspaceManagement(args, value, theme);
  if (workspaceManagement) return workspaceManagement;
  const status = renderStatus(args, value, theme);
  if (status) return status;
  return renderStructured(value, theme).join("\n");
}
