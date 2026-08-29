import { resolveRuntimeLayout, resolveRuntimeLayoutForNamedRole, type RuntimeLayout } from "@queqiao/platform-paths";

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function isWorkerOwnedRoute(args: readonly string[]): boolean {
  const domain = args[0];
  const action = args[1];
  return (
    (domain === "workspace" && ["add", "list", "remove"].includes(action || "")) ||
    (domain === "profile" && action === "set") ||
    (domain === "tool" && ["allow", "deny"].includes(action || "")) ||
    (domain === "command" && ["allow", "deny"].includes(action || "")) ||
    (domain === "permissions" && action === "show")
  );
}

function isGatewayDiagnosticRoute(args: readonly string[]): boolean {
  return (args[0] === "manifest" && args[1] === "show") || (args[0] === "tool" && args[1] === "explain");
}

export function assertCommandOwnership(args: readonly string[]): void {
  if (option(args, "file")) throw new Error("--file is not supported; Queqiao role ownership determines the config layout");
  if (isWorkerOwnedRoute(args) && !option(args, "worker")) throw new Error("--worker is required for Worker-owned configuration");
  if (isGatewayDiagnosticRoute(args) && !option(args, "gateway")) throw new Error("--gateway is required for Gateway-owned diagnostics");
  if (args[0] === "gateway" && args[1] === "join-token" && !option(args, "gateway")) throw new Error("--gateway is required for Gateway enrollment");
  if (args[0] === "worker" && args[1] === "join" && !option(args, "worker")) throw new Error("--worker is required for Worker enrollment");
}

export function resolveCommandLayout(args: readonly string[]): RuntimeLayout {
  const domain = args[0];
  const action = args[1];
  const gatewayName = option(args, "gateway");
  const workerName = option(args, "worker");

  if (domain === "gateway") return resolveRuntimeLayoutForNamedRole("gateway", gatewayName);
  if (domain === "worker" && ["setup", "remove", "serve", "stop", "status", "join", "port"].includes(action || "")) return resolveRuntimeLayoutForNamedRole("worker", workerName);
  if (domain === "membership" && ["list", "update", "remove"].includes(action || "")) return resolveRuntimeLayoutForNamedRole("gateway", gatewayName);
  if (isWorkerOwnedRoute(args) && workerName) return resolveRuntimeLayoutForNamedRole("worker", workerName);
  if (isGatewayDiagnosticRoute(args)) return resolveRuntimeLayoutForNamedRole("gateway", option(args, "gateway"));
  return resolveRuntimeLayout();
}
