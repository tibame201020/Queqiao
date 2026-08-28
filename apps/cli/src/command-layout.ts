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
    (domain === "permissions" && action === "show") ||
    (domain === "discovery" && ["list", "add", "remove"].includes(action || ""))
  );
}

export function assertCommandOwnership(args: readonly string[]): void {
  if (option(args, "file")) throw new Error("--file is not supported; Queqiao role ownership determines the config layout");
  if (isWorkerOwnedRoute(args) && !option(args, "worker")) throw new Error("--worker is required for Worker-owned configuration");
}

export function resolveCommandLayout(args: readonly string[]): RuntimeLayout {
  const domain = args[0];
  const action = args[1];
  const localName = option(args, "name") || "default";
  const workerName = option(args, "worker");

  if (domain === "gateway") return resolveRuntimeLayoutForNamedRole("gateway", localName);
  if (domain === "worker" && ["setup", "serve", "stop", "status", "join", "port"].includes(action || "")) return resolveRuntimeLayoutForNamedRole("worker", localName);
  if (domain === "worker" && ["list", "update", "remove"].includes(action || "")) return resolveRuntimeLayoutForNamedRole("gateway", option(args, "gateway-name") || option(args, "name") || "default");
  if (isWorkerOwnedRoute(args) && workerName) return resolveRuntimeLayoutForNamedRole("worker", workerName);
  return resolveRuntimeLayout();
}
