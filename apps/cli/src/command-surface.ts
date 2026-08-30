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
  if (domain === "worker" && action === "update") {
    return removedRoute(`queqiao gateway workers ${action}`);
  }
  if (domain === "workspace" && ["add", "list", "remove"].includes(action || "")) {
    return removedRoute(`queqiao worker workspace ${action}`);
  }
  if (domain === "profile" && action === "set") return removedRoute("queqiao worker workspace");
  if (domain === "tool" && ["allow", "deny"].includes(action || "")) return removedRoute("queqiao worker workspace");
  if (domain === "command" && ["allow", "deny"].includes(action || "")) return removedRoute("queqiao worker workspace");
  if (domain === "permissions" && action === "show") return removedRoute("queqiao worker workspace");
  if (domain === "extension" && action === "doctor") return removedRoute("queqiao doctor extension");
  if (domain === "manifest" && action === "show") return removedRoute("queqiao doctor manifest show --gateway <name>");
  if (domain === "tool" && action === "explain") return removedRoute("queqiao doctor tool explain <tool> --gateway <name>");
  if (domain === "config" && action === "paths") return removedRoute("queqiao doctor paths");

  if (domain === "gateway" && action === "workers" && ["list", "update", "remove"].includes(resource || "")) {
    return replacePrefix(args, 3, ["membership", resource!]);
  }

  if (domain === "worker" && action === "workspace") {
    if (["add", "list", "info", "edit", "remove"].includes(resource || "")) return replacePrefix(args, 3, ["workspace", resource!]);
    if (resource === "profile" || resource === "tool" || resource === "command" || resource === "permissions") {
      return removedRoute("queqiao worker workspace");
    }
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
export const COMMAND_TREE: CommandNode = {
  children: {
    version: terminal,
    completion: terminal,
    gateway: {
      children: {
        list: terminal,
        setup: terminal,
        remove: terminal,
        serve: terminal,
        stop: terminal,
        status: terminal,
        info: terminal,
        "join-token": terminal,
        workers: { children: { list: terminal, update: terminal, remove: terminal } },
      },
    },
    worker: {
      children: {
        list: terminal,
        setup: terminal,
        remove: terminal,
        port: terminal,
        serve: terminal,
        stop: terminal,
        status: terminal,
        join: terminal,
        workspace: {
          terminal: true,
          children: {
            add: terminal,
            list: terminal,
            info: terminal,
            edit: terminal,
            remove: terminal,
            profiles: { children: { list: terminal, info: terminal, create: terminal, edit: terminal, rename: terminal, delete: terminal } },
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
    uninstall: terminal,
    migrate: { children: { "from-repo": terminal, "runtime-v1": terminal } },
  },
};

export type CliHandlerKey =
  | "list-role-instances" | "role-setup" | "role-remove" | "runtime-serve" | "runtime-stop" | "runtime-status"
  | "gateway-info" | "gateway-join-token" | "membership-list" | "membership-update" | "membership-remove" | "worker-port" | "worker-join"
  | "workspace-manager" | "workspace-add" | "workspace-list" | "workspace-info" | "workspace-edit" | "workspace-remove" | "workspace-profiles-list" | "workspace-profiles-info" | "workspace-profiles-create" | "workspace-profiles-edit" | "workspace-profiles-rename" | "workspace-profiles-delete"
  | "extension-install" | "extension-attach" | "extension-detach" | "extension-uninstall" | "extension-list" | "extension-show" | "extension-doctor"
  | "version" | "completion" | "doctor" | "doctor-paths" | "manifest-show" | "tool-explain" | "uninstall" | "migrate-from-repo" | "migrate-runtime-v1";

type CliLeafContract = {
  route: string;
  handler: CliHandlerKey;
  options: readonly string[];
  valueOptions?: readonly string[];
  positionals?: number;
  positionalValues?: readonly string[];
};

/** Public parser contract. Keep handler-only compatibility flags explicit here. */
export const CLI_LEAF_CONTRACTS: readonly CliLeafContract[] = [
  { route: "version", handler: "version", options: [] },
  { route: "completion", handler: "completion", options: [], positionals: 1, positionalValues: ["bash", "zsh", "powershell"] },
  { route: "gateway list", handler: "list-role-instances", options: [] },
  { route: "gateway setup", handler: "role-setup", options: [] },
  { route: "gateway remove", handler: "role-remove", options: ["gateway"], valueOptions: ["gateway"] },
  { route: "gateway serve", handler: "runtime-serve", options: ["bg", "gateway"], valueOptions: ["gateway"] },
  { route: "gateway stop", handler: "runtime-stop", options: ["gateway"], valueOptions: ["gateway"] },
  { route: "gateway status", handler: "runtime-status", options: ["gateway"], valueOptions: ["gateway"] },
  { route: "gateway info", handler: "gateway-info", options: ["gateway", "detail", "copy-url", "copy-secret"], valueOptions: ["gateway"] },
  { route: "gateway join-token", handler: "gateway-join-token", options: ["gateway", "expires"], valueOptions: ["gateway", "expires"] },
  { route: "gateway workers list", handler: "membership-list", options: ["gateway"], valueOptions: ["gateway"] },
  { route: "gateway workers update", handler: "membership-update", options: ["gateway", "worker-id", "endpoint"], valueOptions: ["gateway", "worker-id", "endpoint"] },
  { route: "gateway workers remove", handler: "membership-remove", options: ["gateway", "worker-id"], valueOptions: ["gateway", "worker-id"] },
  { route: "worker list", handler: "list-role-instances", options: [] },
  { route: "worker setup", handler: "role-setup", options: [] },
  { route: "worker remove", handler: "role-remove", options: ["worker"], valueOptions: ["worker"] },
  { route: "worker port", handler: "worker-port", options: ["worker", "port"], valueOptions: ["worker", "port"] },
  { route: "worker serve", handler: "runtime-serve", options: ["bg", "worker"], valueOptions: ["worker"] },
  { route: "worker stop", handler: "runtime-stop", options: ["worker"], valueOptions: ["worker"] },
  { route: "worker status", handler: "runtime-status", options: ["worker"], valueOptions: ["worker"] },
  { route: "worker join", handler: "worker-join", options: ["worker", "join-code"], valueOptions: ["worker", "join-code"] },
  { route: "worker workspace", handler: "workspace-manager", options: ["worker"], valueOptions: ["worker"] },
  { route: "worker workspace add", handler: "workspace-add", options: ["worker", "root", "display-name", "access-profile"], valueOptions: ["worker", "root", "display-name", "access-profile"] },
  { route: "worker workspace list", handler: "workspace-list", options: ["worker"], valueOptions: ["worker"] },
  { route: "worker workspace info", handler: "workspace-info", options: ["worker", "workspace"], valueOptions: ["worker", "workspace"] },
  { route: "worker workspace edit", handler: "workspace-edit", options: ["worker", "workspace", "root", "display-name", "access-profile"], valueOptions: ["worker", "workspace", "root", "display-name", "access-profile"] },
  { route: "worker workspace remove", handler: "workspace-remove", options: ["worker", "workspace"], valueOptions: ["worker", "workspace"] },
  { route: "worker workspace profiles list", handler: "workspace-profiles-list", options: [] },
  { route: "worker workspace profiles info", handler: "workspace-profiles-info", options: ["profile"], valueOptions: ["profile"] },
  { route: "worker workspace profiles create", handler: "workspace-profiles-create", options: ["name", "tools", "commands"], valueOptions: ["name", "tools", "commands"] },
  { route: "worker workspace profiles edit", handler: "workspace-profiles-edit", options: ["profile", "tools", "commands"], valueOptions: ["profile", "tools", "commands"] },
  { route: "worker workspace profiles rename", handler: "workspace-profiles-rename", options: ["profile", "to"], valueOptions: ["profile", "to"] },
  { route: "worker workspace profiles delete", handler: "workspace-profiles-delete", options: ["profile", "force"], valueOptions: ["profile"] },
  { route: "extension install", handler: "extension-install", options: ["source", "worker", "attach-all"], valueOptions: ["source", "worker"], positionals: 1 },
  { route: "extension attach", handler: "extension-attach", options: ["id", "worker"], valueOptions: ["id", "worker"], positionals: 1 },
  { route: "extension detach", handler: "extension-detach", options: ["id", "worker"], valueOptions: ["id", "worker"], positionals: 1 },
  { route: "extension uninstall", handler: "extension-uninstall", options: ["id", "force"], valueOptions: ["id"], positionals: 1 },
  { route: "extension list", handler: "extension-list", options: [] },
  { route: "extension show", handler: "extension-show", options: ["id"], valueOptions: ["id"], positionals: 1 },
  { route: "doctor", handler: "doctor", options: [] },
  { route: "doctor extension", handler: "extension-doctor", options: [] },
  { route: "doctor manifest show", handler: "manifest-show", options: ["gateway"], valueOptions: ["gateway"] },
  { route: "doctor tool explain", handler: "tool-explain", options: ["gateway", "tool"], valueOptions: ["gateway", "tool"], positionals: 1 },
  { route: "doctor paths", handler: "doctor-paths", options: [] },
  { route: "uninstall", handler: "uninstall", options: [] },
  { route: "migrate from-repo", handler: "migrate-from-repo", options: ["repo", "execute"], valueOptions: ["repo"] },
  { route: "migrate runtime-v1", handler: "migrate-runtime-v1", options: ["execute"] },
];

export type ParsedCliLeafArguments = {
  route: string;
  handler: CliHandlerKey;
  positionals: string[];
  options: Readonly<Record<string, string | true>>;
};

export type CliDispatch = ParsedCliLeafArguments;

export function resolveCliDispatch(input: readonly string[]): CliDispatch | undefined {
  return parseCliLeafArguments(input);
}

export function parseCliLeafArguments(input: readonly string[]): ParsedCliLeafArguments | undefined {
  const tokens = input.filter((token) => token !== "--json" && token !== "--help" && token !== "-h");
  const contract = [...CLI_LEAF_CONTRACTS]
    .sort((a, b) => b.route.split(" ").length - a.route.split(" ").length)
    .find(({ route }) => {
      const parts = route.split(" ");
      return parts.every((part, index) => tokens[index] === part);
    });
  if (!contract) return undefined;
  const routeLength = contract.route.split(" ").length;
  const positionals: string[] = [];
  const options: Record<string, string | true> = {};
  for (let index = routeLength; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }
    const name = token.slice(2);
    if (contract.valueOptions?.includes(name)) {
      const value = tokens[index + 1];
      if (value && !value.startsWith("--")) {
        options[name] = value;
        index += 1;
      }
      continue;
    }
    options[name] = true;
  }
  return { route: contract.route, handler: contract.handler, positionals, options };
}

export function validateCliArgs(input: readonly string[]): void {
  const tokens = input.filter((token) => token !== "--json" && token !== "--help" && token !== "-h");
  const contract = [...CLI_LEAF_CONTRACTS]
    .sort((a, b) => b.route.split(" ").length - a.route.split(" ").length)
    .find(({ route }) => {
      const parts = route.split(" ");
      return parts.every((part, index) => tokens[index] === part);
    });
  if (!contract) {
    const unknown = tokens.find((token) => token.startsWith("--"));
    if (unknown) throw new Error(`Unknown global option "${unknown}".`);
    return;
  }
  const routeLength = contract.route.split(" ").length;
  let positionalCount = 0;
  const seenOptions = new Set<string>();
  for (let index = routeLength; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    if (!token.startsWith("--")) {
      positionalCount += 1;
      continue;
    }
    const name = token.slice(2);
    if (!contract.options.includes(name)) throw new Error(`Unknown option "--${name}" for "queqiao ${contract.route}".`);
    seenOptions.add(name);
    if (contract.valueOptions?.includes(name)) {
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) throw new Error(`Option "--${name}" requires a value.`);
      index += 1;
    }
  }
  if (positionalCount > (contract.positionals || 0)) throw new Error(`Unexpected argument for "queqiao ${contract.route}".`);
  for (const name of REQUIRED_OPTIONS[contract.route] || []) {
    if (!seenOptions.has(name)) throw new Error(`--${name} is required for "queqiao ${contract.route}".`);
  }
}

export function renderRemovedSelectorError(input: readonly string[]): string | undefined {
  if (!input.includes("--name")) return undefined;
  const [domain, action, resource] = input;
  if (domain === "gateway" && !["setup", "list"].includes(action || "")) {
    return 'Option "--name" was removed; use "--gateway <name>".';
  }
  if (domain === "worker" && action === "workspace" && resource === "add") {
    return 'Workspace option "--name" was removed; use "--display-name <name>".';
  }
  if (domain === "worker" && action === "workspace" && resource === "profiles") return undefined;
  if (domain === "worker" && !["setup", "list"].includes(action || "")) {
    return 'Option "--name" was removed; use "--worker <name>".';
  }
  return undefined;
}

export function listCanonicalCliRoutes(): string[] {
  const routes: string[] = [];
  const visit = (node: CommandNode, prefix: string[]) => {
    if (node.terminal) routes.push(prefix.join(" "));
    for (const [name, child] of Object.entries(node.children || {})) visit(child, [...prefix, name]);
  };
  visit(COMMAND_TREE, []);
  return routes.sort();
}

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
  const prefixMatches = candidates.filter((candidate) => candidate.startsWith(value));
  if (prefixMatches.length > 0) return prefixMatches.sort((left, right) => left.localeCompare(right));

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
    if (node.terminal && Object.keys(children).length === 0) return undefined;
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
  version      Print the installed Queqiao version
  completion   Print shell tab-completion setup
  gateway      Manage a Queqiao Gateway
  worker       Manage a Queqiao Worker
  extension    Manage Queqiao extensions
  doctor       Diagnose Queqiao
  uninstall    Remove Queqiao and Queqiao-owned local state

Global options:
  --version, -v  Print the installed Queqiao version
  --json         Print machine-readable JSON

Run "queqiao <command> --help" for command details.`;

const GATEWAY_HELP = `Usage: queqiao gateway <command> [options]

Commands:
  list
  setup
  remove
  serve [--bg]
  stop
  status
  info
  join-token
  workers list
  workers update
  workers remove`;

const COMPLETION_HELP = `Usage: queqiao completion <bash|zsh|powershell>

Prints a shell completion script generated from the canonical Queqiao CLI contract.

Examples:
  Bash:       eval "$(queqiao completion bash)"
  Zsh:        eval "$(queqiao completion zsh)"
  PowerShell: queqiao completion powershell | Out-String | Invoke-Expression`;

const GATEWAY_INFO_HELP = `Usage: queqiao gateway info [--gateway <gateway>] [--detail] [--copy-url|--copy-secret] [--json]

Shows the MCP connector URL and local approval-secret availability.
Use --detail to reveal the approval secret locally. Use copy options to copy one value without printing it.
Instance selectors are required outside an interactive terminal.`;

const GATEWAY_JOIN_TOKEN_HELP = `Usage: queqiao gateway join-token [--gateway <gateway>] [--expires <seconds>] [--json]

Creates a self-contained one-time join code and copies it to the clipboard.
Default expiry: 300 seconds. Allowed range: 30-3600 seconds.`;

const WORKER_JOIN_HELP = `Usage: queqiao worker join [--worker <worker>] [--join-code <code>] [--json]

Without --join-code, prompts securely for one self-contained join code.
Gateway URL and Worker endpoint are derived automatically.`;

const GATEWAY_WORKERS_HELP = `Usage: queqiao gateway workers <command> [options]

Commands:
  list
  update --worker-id <id> --endpoint <loopback-worker-url>
  remove --worker-id <id>`;

const WORKER_HELP = `Usage: queqiao worker <command> [options]

Commands:
  list
  setup
  remove
  port
  serve [--bg]
  stop
  status
  join
  workspace ...`;

const WORKER_WORKSPACE_HELP = `Usage: queqiao worker workspace [command] [options]

Without a command in an interactive terminal, opens Workspace Management.

Workspace commands:
  list [--worker <worker>]
  info [--worker <worker>] [--workspace <id>]
  add [--worker <worker>] [--root <dir>] [--display-name <name>] [--access-profile <name>]
  edit [--worker <worker>] [--workspace <id>] [--root <dir>] [--display-name <name>] [--access-profile <name>]
  remove [--worker <worker>] [--workspace <id>]

Access Profile commands:
  profiles list
  profiles info [--profile <name>]
  profiles create [--name <name>] [--tools <csv>] [--commands <csv>]
  profiles edit [--profile <name>] [--tools <csv>] [--commands <csv>]
  profiles rename [--profile <name>] [--to <name>]
  profiles delete [--profile <name>] [--force]

Access Profiles are reusable templates. Applying one copies its policy to a Workspace; later profile edits, renames, or deletion do not change existing Workspaces.`;

const EXTENSION_HELP = `Usage: queqiao extension <command> [options]

Commands:
  install <npm:package|local-path> [--worker <name>|--attach-all]
  attach [<id>] [--worker <name>]
  detach [<id>] [--worker <name>]
  uninstall [<id>] [--force]
  list
  show [<id>]`;

const DOCTOR_HELP = `Usage: queqiao doctor [diagnostic] [options]

Diagnostics:
  extension
  manifest show [--gateway <name>]
  tool explain <tool> [--gateway <name>]
  paths`;

const UNINSTALL_HELP = `Usage: queqiao uninstall

Interactively select Queqiao-owned items to remove, review the selection, then confirm before cleanup.`;

const MIGRATE_HELP = `Usage: queqiao migrate <command> [options]

Advanced compatibility commands:
  migrate from-repo [--repo <directory>] [--execute]
  migrate runtime-v1 [--execute]`;

const REQUIRED_OPTIONS: Readonly<Record<string, readonly string[]>> = {
  "gateway workers update": ["worker-id", "endpoint"],
  "gateway workers remove": ["worker-id"],
};

const POSITIONAL_USAGE: Readonly<Record<string, string>> = {
  "extension install": " <npm:package|local-path>",
  "extension attach": " [<id>]",
  "extension detach": " [<id>]",
  "extension uninstall": " [<id>]",
  "extension show": " [<id>]",
  "doctor tool explain": " <tool>",
};

function optionUsage(name: string, takesValue: boolean): string {
  if (!takesValue) return `--${name}`;
  const placeholders: Record<string, string> = {
    gateway: "gateway", worker: "worker", expires: "seconds", port: "port", root: "dir",
    "display-name": "name", "access-profile": "name", profile: "name", id: "id", workspace: "id", tool: "tool",
    command: "executable", commands: "csv", tools: "csv", name: "name", to: "name", "worker-id": "id", endpoint: "url", repo: "directory", source: "npm:package",
    "join-code": "code",
  };
  return `--${name} <${placeholders[name] || "value"}>`;
}

function renderLeafContractHelp(input: readonly string[]): string | undefined {
  const commandTokens = input.filter((token) => token !== "--help" && token !== "-h" && token !== "--json" && !token.startsWith("--"));
  const contract = [...CLI_LEAF_CONTRACTS]
    .sort((a, b) => b.route.split(" ").length - a.route.split(" ").length)
    .find(({ route }) => route === commandTokens.slice(0, route.split(" ").length).join(" "));
  if (!contract || contract.route === "doctor") return undefined;
  const required = REQUIRED_OPTIONS[contract.route] || [];
  const options = contract.options.map((name) => {
    const value = optionUsage(name, Boolean(contract.valueOptions?.includes(name)));
    return required.includes(name) ? value : `[${value}]`;
  });
  const selectorNote = contract.options.some((name) => name === "gateway" || name === "worker")
    ? " Instance selectors are required outside an interactive terminal."
    : "";
  return `Usage: queqiao ${contract.route}${POSITIONAL_USAGE[contract.route] || ""}${options.length ? ` ${options.join(" ")}` : ""}\n\nRun with --json for machine-readable output.${selectorNote}`;
}

export function isCliHelpContext(input: readonly string[]): boolean {
  const args = input.filter((arg) => arg !== "--json" && arg !== "--help" && arg !== "-h" && !arg.startsWith("--"));
  return (
    (args.length === 1 && ["gateway", "worker", "extension"].includes(args[0] || "")) ||
    (args.length === 2 && args[0] === "gateway" && args[1] === "workers") ||
    false
  );
}

export function renderCliHelp(input: readonly string[]): string {
  const args = input.filter((arg) => arg !== "--help" && arg !== "-h");
  const [domain, action] = args;
  if (!domain) return ROOT_HELP;
  if (domain === "completion") return COMPLETION_HELP;
  if (domain === "gateway") {
    if (action === "info") return GATEWAY_INFO_HELP;
    if (action === "join-token") return GATEWAY_JOIN_TOKEN_HELP;
    const leaf = renderLeafContractHelp(input);
    if (leaf) return leaf;
    return action === "workers" ? GATEWAY_WORKERS_HELP : GATEWAY_HELP;
  }
  if (domain === "worker") {
    if (action === "join") return WORKER_JOIN_HELP;
    const workspaceCommandTokens = input.filter((token) => token !== "--help" && token !== "-h" && token !== "--json" && !token.startsWith("--"));
    if (action === "workspace" && workspaceCommandTokens.length === 2) return WORKER_WORKSPACE_HELP;
    const leaf = renderLeafContractHelp(input);
    if (leaf) return leaf;
    if (action === "workspace") return WORKER_WORKSPACE_HELP;
    return WORKER_HELP;
  }
  if (domain === "extension") return renderLeafContractHelp(input) || EXTENSION_HELP;
  if (domain === "doctor") return renderLeafContractHelp(input) || DOCTOR_HELP;
  if (domain === "uninstall") return UNINSTALL_HELP;
  if (domain === "migrate") return renderLeafContractHelp(input) || MIGRATE_HELP;
  return ROOT_HELP;
}
