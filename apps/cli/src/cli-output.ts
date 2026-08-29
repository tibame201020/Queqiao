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

function renderStructured(value: unknown, indent = 0): string[] {
  const pad = " ".repeat(indent);
  if (Array.isArray(value)) {
    if (!value.length) return [`${pad}None`];
    const lines: string[] = [];
    for (const item of value) {
      if (item && typeof item === "object") {
        lines.push(`${pad}-`);
        lines.push(...renderStructured(item, indent + 2));
      } else {
        lines.push(`${pad}- ${scalar(item)}`);
      }
    }
    return lines;
  }
  if (value && typeof value === "object") {
    const lines: string[] = [];
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (child && typeof child === "object") {
        lines.push(`${pad}${label(key)}:`);
        lines.push(...renderStructured(child, indent + 2));
      } else {
        lines.push(`${pad}${label(key)}: ${scalar(child)}`);
      }
    }
    return lines;
  }
  return [`${pad}${scalar(value)}`];
}

function isNotConfigured(role: string, health: Record<string, unknown>): boolean {
  const error = typeof health.error === "string" ? health.error : "";
  return error === `${role} is not configured` || (/ENOENT/.test(error) && /config\.yaml/.test(error));
}

function renderRoleInventory(args: readonly string[], value: unknown): string | undefined {
  if (!((args[0] === "gateway" || args[0] === "worker") && args[1] === "list")) return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (!Array.isArray(result.instances)) return undefined;
  const label = args[0] === "gateway" ? "Gateways" : "Workers";
  if (!result.instances.length) return `${label}: None`;
  const lines = [`${label}:`];
  for (const item of result.instances) {
    const instance = item as Record<string, unknown>;
    lines.push(`  ${scalar(instance.name)}  ${instance.running === true ? "Running" : instance.configured === false ? "Invalid configuration" : "Stopped"}`);
    if (args[0] === "gateway") lines.push(`    URL: ${scalar(instance.publicUrl)}`, `    Ports: ${scalar(instance.servicePort)} / management ${scalar(instance.managementPort)}`);
    else lines.push(`    Endpoint: ${scalar(instance.endpoint)}`, `    Workspaces: ${scalar(instance.workspaceCount)}`);
  }
  return lines.join("\n");
}

function renderJoinToken(args: readonly string[], value: unknown): string | undefined {
  if (args[0] !== "gateway" || args[1] !== "join-token") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  const expiresAt = typeof result.expiresAt === "string" ? result.expiresAt : "unknown";
  const copied = result.copied === true;
  const lines: string[] = [];

  if (copied) {
    lines.push("Join code copied to clipboard", `  Expires At: ${expiresAt}`);
  } else {
    lines.push("Join code could not be copied", `  Expires At: ${expiresAt}`);
    if (typeof result.joinCode === "string" && result.joinCode) {
      lines.push("", "Join code:", `  ${result.joinCode}`);
    }
    if (typeof result.copyError === "string" && result.copyError) {
      lines.push(`  Copy Error: ${result.copyError}`);
    }
  }

  lines.push("", "Next (before expiry, on the target Worker host):", "  queqiao worker join --worker <worker>");
  return lines.join("\n");
}

function renderWorkerJoin(args: readonly string[], value: unknown): string | undefined {
  if (args[0] !== "worker" || args[1] !== "join") return undefined;
  if (!value || typeof value !== "object") return undefined;
  const result = value as Record<string, unknown>;
  if (result.joined !== true) return undefined;
  const name = option(args, "worker") || "worker";
  const lines = [`Worker joined Gateway: ${name}`];
  if (typeof result.workerId === "string") lines.push(`  Worker Id: ${result.workerId}`);
  if (typeof result.environmentId === "string") lines.push(`  Environment Id: ${result.environmentId}`);
  return lines.join("\n");
}

function renderStatus(args: readonly string[], value: unknown): string | undefined {
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
  const lines = [
    `${roleLabel} ${name}`,
    `  Status: ${!configured ? "Not configured" : active ? "Running" : "Stopped"}`,
    `  Managed: ${managed ? "Yes" : "No"}`,
  ];
  if (typeof result.pid === "number") lines.push(`  PID: ${result.pid}`);
  if (configured && !active) {
    const error = typeof health.error === "string" ? health.error : "";
    if (error) lines.push(`  Detail: ${error}`);
  }
  if (!configured) {
    lines.push("", `Next: queqiao ${role} setup`);
  } else if (!active) {
    lines.push("", `Next: queqiao ${role} serve --bg --${selector} ${name}`);
  }
  return lines.join("\n");
}

export function formatCliOutput(input: readonly string[], value: unknown): string {
  if (input.includes("--json")) return JSON.stringify(value, null, 2);
  const args = input.filter((arg) => arg !== "--json");
  const inventory = renderRoleInventory(args, value);
  if (inventory) return inventory;
  const joinToken = renderJoinToken(args, value);
  if (joinToken) return joinToken;
  const workerJoin = renderWorkerJoin(args, value);
  if (workerJoin) return workerJoin;
  const status = renderStatus(args, value);
  if (status) return status;
  return renderStructured(value).join("\n");
}
