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
  if (domain === "extension" && action === "doctor") return removedRoute("queqiao doctor extension");
  if (domain === "manifest" && action === "show") return removedRoute("queqiao doctor manifest show --gateway <name>");
  if (domain === "tool" && action === "explain") return removedRoute("queqiao doctor tool explain <tool> --gateway <name>");
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

  if (domain === "doctor") {
    if (action === "extension") return replacePrefix(args, 2, ["extension", "doctor"]);
    if (action === "manifest" && resource === "show") return replacePrefix(args, 3, ["manifest", "show"]);
    if (action === "tool" && resource === "explain") return replacePrefix(args, 3, ["tool", "explain"]);
    if (action === "paths") return replacePrefix(args, 2, ["config", "paths"]);
  }

  return args;
}

type CommandNode = {
  children?: Record<string, CommandNode>;
  terminal?: boolean;
};

const terminal: CommandNode = { terminal: true };
const COMMAND_TREE: CommandNode = {
  children: {
    gateway: {
      children: {
        setup: terminal,
        serve: terminal,
        stop: terminal,
        status: terminal,
        "join-token": terminal,
        workers: { children: { list: terminal, update: terminal, remove: terminal } },
      },
    },
    worker: {
      children: {
        setup: terminal,
        port: terminal,
        serve: terminal,
        stop: terminal,
        status: terminal,
        join: terminal,
        workspace: {
          children: {
            add: terminal,
            list: terminal,
            remove: terminal,
            profile: { children: { set: terminal } },
            tool: { children: { allow: terminal, deny: terminal } },
            command: { children: { allow: terminal, deny: terminal } },
            permissions: { children: { show: terminal } },
          },
        },
      },
    },
    extension: {
      children: {
        install: terminal,
        attach: terminal,
        detach: terminal,
        uninstall: terminal,
        list: terminal,
        show: terminal,
      },
    },
    doctor: {
      terminal: true,
      children: {
        extension: terminal,
        manifest: { children: { show: terminal } },
        tool: { children: { explain: terminal } },
        paths: terminal,
      },
    },
    migrate: { children: { "from-repo": terminal, "runtime-v1": terminal } },
  },
};

function editDistance(a: string, b: string): number {
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = previous[0]!;
    previous[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j]!;
      previous[j] = Math.min(
        previous[j]! + 1,
        previous[j - 1]! + 1,
        diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
      diagonal = above;
    }
  }
  return previous[b.length]!;
}

function suggestions(value: string, candidates: string[]): string[] {
  const ranked = candidates
    .map((candidate) => ({ candidate, distance: editDistance(value, candidate) }))
    .sort((left, right) => left.distance - right.distance || left.candidate.localeCompare(right.candidate));
  if (!ranked.length) return [];
  const first = ranked[0]!;
  const best = first.distance;
  const threshold = Math.max(2, Math.floor(Math.max(value.length, 4) * 0.4));
  if (best > threshold) return [];
  return [first.candidate];
}

export function renderCliRouteError(input: readonly string[]): string | undefined {
  const args = input.filter((arg) => arg !== "--json" && arg !== "--help" && arg !== "-h");
  let node = COMMAND_TREE;
  const context: string[] = [];
  for (const token of args) {
    if (token.startsWith("--")) break;
    const children = node.children || {};
    if (children[token]) {
      node = children[token];
      context.push(token);
      continue;
    }
    if (node.terminal) return undefined;
    const commandContext = context.length ? `queqiao ${context.join(" ")}` : "queqiao";
    const nearby = suggestions(token, Object.keys(children));
    const lines = [`Unknown command \"${token}\" for \"${commandContext}\".`, ""];
    if (nearby.length) {
      lines.push(nearby.length === 1 ? "Did you mean this?" : "Did you mean one of these?");
      for (const candidate of nearby) lines.push(`  ${candidate}`);
      lines.push("");
    }
    lines.push(`Run \"${commandContext} --help\" for available commands.`);
    return lines.join("\n");
  }
  return undefined;
}

const ROOT_HELP = `Usage: queqiao <command> [options]

Commands:
  gateway      Manage a Queqiao Gateway
  worker       Manage a Queqiao Worker
  extension    Manage Queqiao extensions
  doctor       Diagnose Queqiao

Global options:
  --json       Print machine-readable JSON

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
  worker workspace ...`;

const WORKER_WORKSPACE_HELP = `Usage: queqiao worker workspace <command> [options]

Commands:
  worker workspace add --worker <worker>
  worker workspace list --worker <worker>
  worker workspace remove --worker <worker> --id <id>
  worker workspace profile set --worker <worker> --workspace <id> --profile read-only|editor|coding
  worker workspace tool allow|deny --worker <worker> --workspace <id> --tool <tool>
  worker workspace command allow|deny --worker <worker> --workspace <id> --command <executable>
  worker workspace permissions show --worker <worker> [--workspace <id>]`;

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
  doctor manifest show --gateway <name>
  doctor tool explain <tool> --gateway <name>
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
    return WORKER_HELP;
  }
  if (domain === "extension") return EXTENSION_HELP;
  if (domain === "doctor") return DOCTOR_HELP;
  if (domain === "migrate") return MIGRATE_HELP;
  return ROOT_HELP;
}
