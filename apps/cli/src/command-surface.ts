function replacePrefix(args: string[], length: number, replacement: string[]): string[] {
  return [...replacement, ...args.slice(length)];
}

const REMOVED_ROUTE = "__removed_cli_route__";

function removedRoute(replacement: string): string[] {
  return [REMOVED_ROUTE, `Command removed; use \"${replacement}\".`];
}

export function isRemovedCliRoute(args: readonly string[]): boolean {
  return args[0] === REMOVED_ROUTE;
}

export function normalizeCliArgs(input: readonly string[]): string[] {
  const args = [...input];
  const [domain, action, resource, subaction] = args;

  // Reject the former flat public surface before translating canonical commands
  // to the existing internal handler routes.
  if (domain === "worker" && ["list", "update", "remove"].includes(action || "")) {
    return removedRoute(`queqiao gateway workers ${action}`);
  }
  if (domain === "workspace" && ["add", "list", "remove"].includes(action || "")) {
    return removedRoute(`queqiao worker workspace ${action}`);
  }
  if (domain === "profile" && action === "set") return removedRoute("queqiao worker workspace profile set");
  if (domain === "tool" && ["allow", "deny"].includes(action || "")) return removedRoute(`queqiao worker workspace tool ${action}`);
  if (domain === "command" && ["allow", "deny"].includes(action || "")) return removedRoute(`queqiao worker workspace command ${action}`);
  if (domain === "permissions" && action === "show") return removedRoute("queqiao worker workspace permissions show");
  if (domain === "discovery" && ["list", "add", "remove"].includes(action || "")) return removedRoute(`queqiao worker discovery ${action}`);
  if (domain === "extension" && action === "doctor") return removedRoute("queqiao doctor extension");
  if (domain === "manifest" && action === "show") return removedRoute("queqiao doctor manifest show");
  if (domain === "tool" && action === "explain") return removedRoute("queqiao doctor tool explain");
  if (domain === "config" && action === "paths") return removedRoute("queqiao doctor paths");

  if (domain === "gateway" && action === "workers" && ["list", "update", "remove"].includes(resource || "")) {
    return replacePrefix(args, 3, ["worker", resource!]);
  }

  if (domain === "worker" && action === "workspace") {
    if (["add", "list", "remove"].includes(resource || "")) return replacePrefix(args, 3, ["workspace", resource!]);
    if (resource === "profile" && subaction === "set") return replacePrefix(args, 4, ["profile", "set"]);
    if (resource === "tool" && ["allow", "deny"].includes(subaction || "")) return replacePrefix(args, 4, ["tool", subaction!]);
    if (resource === "command" && ["allow", "deny"].includes(subaction || "")) return replacePrefix(args, 4, ["command", subaction!]);
    if (resource === "permissions" && subaction === "show") return replacePrefix(args, 4, ["permissions", "show"]);
  }

  if (domain === "worker" && action === "discovery" && ["list", "add", "remove"].includes(resource || "")) {
    return replacePrefix(args, 3, ["discovery", resource!]);
  }

  if (domain === "doctor") {
    if (action === "extension") return replacePrefix(args, 2, ["extension", "doctor"]);
    if (action === "manifest" && resource === "show") return replacePrefix(args, 3, ["manifest", "show"]);
    if (action === "tool" && resource === "explain") return replacePrefix(args, 3, ["tool", "explain"]);
    if (action === "paths") return replacePrefix(args, 2, ["config", "paths"]);
  }

  return args;
}

const ROOT_HELP = `Usage: queqiao <command> [options]

Commands:
  gateway      Manage a Queqiao Gateway
  worker       Manage a Queqiao Worker
  extension    Manage Queqiao extensions
  doctor       Diagnose Queqiao

Run "queqiao <command> --help" for command details.`;

const GATEWAY_HELP = `Usage: queqiao gateway <command> [options]

Commands:
  gateway setup
  gateway serve [--bg]
  gateway stop
  gateway status
  gateway join-token
  gateway workers list
  gateway workers update
  gateway workers remove`;

const GATEWAY_WORKERS_HELP = `Usage: queqiao gateway workers <command> [options]

Commands:
  gateway workers list
  gateway workers update --worker-id <id> --endpoint <loopback-worker-url>
  gateway workers remove --worker-id <id>`;

const WORKER_HELP = `Usage: queqiao worker <command> [options]

Commands:
  worker setup
  worker port
  worker serve [--bg]
  worker stop
  worker status
  worker join
  worker workspace ...
  worker discovery ...`;

const WORKER_WORKSPACE_HELP = `Usage: queqiao worker workspace <command> [options]

Commands:
  worker workspace add --worker <worker>
  worker workspace list --worker <worker>
  worker workspace remove --worker <worker> --id <id>
  worker workspace profile set --worker <worker> --workspace <id> --profile read-only|editor|coding
  worker workspace tool allow|deny --worker <worker> --workspace <id> --tool <tool>
  worker workspace command allow|deny --worker <worker> --workspace <id> --command <executable>
  worker workspace permissions show --worker <worker> [--workspace <id>]`;

const WORKER_DISCOVERY_HELP = `Usage: queqiao worker discovery <command> [options]

Commands:
  worker discovery list
  worker discovery add --root <directory>
  worker discovery remove --root <directory>`;

const EXTENSION_HELP = `Usage: queqiao extension <command> [options]

Commands:
  extension install npm:<package> [--worker <name>|--attach-all]
  extension attach <id> --worker <name>
  extension detach <id> --worker <name>
  extension uninstall <id> [--force]
  extension list
  extension show <id>`;

const DOCTOR_HELP = `Usage: queqiao doctor [diagnostic] [options]

Diagnostics:
  doctor
  doctor extension
  doctor manifest show
  doctor tool explain <tool>
  doctor paths`;

const MIGRATE_HELP = `Usage: queqiao migrate <command> [options]

Advanced compatibility commands:
  migrate from-repo [--repo <directory>] [--execute]
  migrate runtime-v1 [--execute]`;

export function renderCliHelp(input: readonly string[]): string {
  const args = input.filter((arg) => arg !== "--help" && arg !== "-h");
  const [domain, action] = args;
  if (!domain) return ROOT_HELP;
  if (domain === "gateway") return action === "workers" ? GATEWAY_WORKERS_HELP : GATEWAY_HELP;
  if (domain === "worker") {
    if (action === "workspace") return WORKER_WORKSPACE_HELP;
    if (action === "discovery") return WORKER_DISCOVERY_HELP;
    return WORKER_HELP;
  }
  if (domain === "extension") return EXTENSION_HELP;
  if (domain === "doctor") return DOCTOR_HELP;
  if (domain === "migrate") return MIGRATE_HELP;
  return ROOT_HELP;
}
