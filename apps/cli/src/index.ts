import path from "node:path";

import { AtomicConfigStore } from "./atomic-config-store.js";
import { runtimeConfigSchema, type RuntimeConfig } from "@queqiao/config";
import { toolNameSchema } from "@queqiao/contracts";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS } from "@queqiao/mcp-compat";
import { buildDeploymentManifest, buildOperationsDiagnostics, explainTool } from "@queqiao/operations";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import { resolveExtensionHubRoot } from "@queqiao/platform-paths";
import { assertCommandOwnership, resolveCommandLayout } from "./command-layout.js";
import { migrateFromRepository, migrateRuntimeLayoutV1 } from "./runtime-migration.js";

import { createJoinToken, joinWorker, listJoinedWorkers, removeJoinedWorker, updateJoinedWorkerTransport, updateWorkerPort } from "./enrollment-cli.js";
import { runRoleSetupWizard } from "./setup-wizard.js";
import { removeRoleInstance } from "./role-remove.js";
import { uninstallQueqiao } from "./uninstall-cli.js";
import { doctorPaths, doctorQueqiao } from "./doctor.js";
import { runtimeStatus, serveRuntime, startRuntime, stopRuntime } from "./service-lifecycle.js";
import { addWorkspace, removeWorkspace, setWorkspaceAccess, updateWorkspaceCommandPolicy, updateWorkspaceToolPolicy } from "./workspace-cli.js";
import { attachExtension, detachExtension, doctorExtensionHub, installExtension, listExtensions, resolveInstalledExtensionId, showExtension, uninstallExtension } from "./extension-cli.js";
import { formatCliOutput } from "./cli-output.js";
import { isCliHelpContext, isRemovedCliRoute, normalizeCliArgs, parseCliLeafArguments, renderCliHelp, renderCliRouteError, renderRemovedSelectorError, validateCliArgs } from "./command-surface.js";
import { listRoleInstances, resolveRoleInstance, selectorRoleForCliArgs, withRoleSelector } from "./instance-selector.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
function print(value: unknown) { process.stdout.write(`${formatCliOutput(outputArgs, value)}\n`); }
function operations(config: RuntimeConfig) { return buildOperationsDiagnostics({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, workerProtocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, supportedMcpProtocolVersions: QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }); }

const rawArgs = process.argv.slice(2);
let outputArgs = rawArgs;
let commandArgs = rawArgs.filter((arg) => arg !== "--json");
let leafArgs = parseCliLeafArguments(commandArgs);
const helpRequested = commandArgs.includes("--help") || commandArgs.includes("-h");
let args = normalizeCliArgs(commandArgs);
let domain = args[0];
let action = args[1];
let selectedRoleName: string | undefined;
const USAGE = renderCliHelp([]);


async function main() {
  if (isRemovedCliRoute(args)) throw new Error(args[1]);
  if (helpRequested) { process.stdout.write(`${renderCliHelp(commandArgs)}\n`); return; }
  if (isCliHelpContext(commandArgs)) { process.stdout.write(`${renderCliHelp(commandArgs)}\n`); return; }
  const selectorError = renderRemovedSelectorError(commandArgs);
  if (selectorError) throw new Error(selectorError);
  const routeError = renderCliRouteError(commandArgs);
  if (routeError) throw new Error(routeError);
  validateCliArgs(commandArgs);
  if (domain === "gateway" && action === "list") return print({ schemaVersion: "1.0", role: "gateway", instances: await listRoleInstances("gateway") });
  if (domain === "worker" && action === "list") return print({ schemaVersion: "1.0", role: "worker", instances: await listRoleInstances("worker") });
  const selectorRole = selectorRoleForCliArgs(commandArgs);
  if (selectorRole) {
    selectedRoleName = await resolveRoleInstance(selectorRole, rawArgs);
    outputArgs = withRoleSelector(rawArgs, selectorRole, selectedRoleName);
    if (!commandArgs.includes(`--${selectorRole}`) && !rawArgs.includes("--json")) {
      process.stderr.write(`Using ${selectorRole === "gateway" ? "Gateway" : "Worker"}: ${selectedRoleName}\n`);
    }
    commandArgs = withRoleSelector(commandArgs, selectorRole, selectedRoleName);
    leafArgs = parseCliLeafArguments(commandArgs);
    args = normalizeCliArgs(commandArgs);
    domain = args[0];
    action = args[1];
  }
  assertCommandOwnership(args);
  if (domain === "gateway" && action === "setup") return print(await runRoleSetupWizard("gateway", args));
  if (domain === "gateway" && action === "remove") return print(await removeRoleInstance("gateway", args));
  if (domain === "worker" && action === "setup") return print(await runRoleSetupWizard("worker", args));
  if (domain === "worker" && action === "remove") return print(await removeRoleInstance("worker", args));
  if (domain === "uninstall") return print(await uninstallQueqiao(args));
  if (domain === "extension" && action === "install") {
    const source = leafArgs?.positionals[0] || (typeof leafArgs?.options.source === "string" ? leafArgs.options.source : undefined);
    if (!source) throw new Error("Extension source is required, for example: npm:queqiao-mcp or .\\my-extension");
    const workerName = option(args, "worker");
    return print(await installExtension(resolveExtensionHubRoot(), source, { ...(workerName ? { workerName } : {}), attachAll: args.includes("--attach-all") }));
  }
  if (domain === "extension" && action === "attach") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), leafArgs?.positionals[0] || (typeof leafArgs?.options.id === "string" ? leafArgs.options.id : undefined));
    return print(await attachExtension(resolveExtensionHubRoot(), id, requiredOption(args, "worker")));
  }
  if (domain === "extension" && action === "detach") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), leafArgs?.positionals[0] || (typeof leafArgs?.options.id === "string" ? leafArgs.options.id : undefined));
    return print(await detachExtension(id, requiredOption(args, "worker")));
  }
  if (domain === "extension" && action === "uninstall") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), leafArgs?.positionals[0] || (typeof leafArgs?.options.id === "string" ? leafArgs.options.id : undefined));
    return print(await uninstallExtension(resolveExtensionHubRoot(), id, args.includes("--force")));
  }
  if (domain === "extension" && action === "list") return print(await listExtensions(resolveExtensionHubRoot()));
  if (domain === "extension" && action === "show") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), leafArgs?.positionals[0] || (typeof leafArgs?.options.id === "string" ? leafArgs.options.id : undefined));
    return print(await showExtension(resolveExtensionHubRoot(), id));
  }
  if (domain === "extension" && action === "doctor") return print(await doctorExtensionHub(resolveExtensionHubRoot()));
  if (domain === "doctor") return print(await doctorQueqiao());
  if (domain === "config" && action === "paths") return print(doctorPaths());

  const layout = resolveCommandLayout(args);
  const configFile = path.resolve(layout.configFile);
  const configStore = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  if (domain === "worker" && action === "port") {
    const status = await runtimeStatus(configFile, layout, "worker", selectedRoleName!);
    if (status.active) throw new Error("Stop the Worker before changing its listener port");
    return print(await updateWorkerPort(configFile, args));
  }
  if (domain === "gateway" && action === "join-token") return print(await createJoinToken(configFile, args));
  if (domain === "worker" && action === "join") return print(await joinWorker(configFile, args));
  if (domain === "membership" && action === "list") return print(await listJoinedWorkers(configFile));
  if (domain === "membership" && action === "update") return print(await updateJoinedWorkerTransport(configFile, requiredOption(args, "worker-id"), requiredOption(args, "endpoint")));
  if (domain === "membership" && action === "remove") return print(await removeJoinedWorker(configFile, requiredOption(args, "worker-id")));
  if (domain === "workspace" && action === "list") { requiredOption(args, "worker"); return print({ ...(await configStore.metadata()), workspaces: (await configStore.read()).workspaces }); }
  if (domain === "workspace" && action === "add") { requiredOption(args, "worker"); return print(await addWorkspace(configFile, args)); }
  if (domain === "workspace" && action === "remove") {
    const id = requiredOption(args, "id"); const workerName = requiredOption(args, "worker");
    return print(await removeWorkspace(configFile, workerName, id));

  }
  if (domain === "profile" && action === "set") return print(await setWorkspaceAccess(configFile, args));
  if (domain === "tool" && (action === "allow" || action === "deny")) return print(await updateWorkspaceToolPolicy(configFile, args));
  if (domain === "command" && (action === "allow" || action === "deny")) return print(await updateWorkspaceCommandPolicy(configFile, args));
  if (domain === "permissions" && action === "show") {
    const config = await configStore.read(); const id = option(args, "workspace"); const selected = id ? config.workspaces.filter((entry) => entry.id === id) : config.workspaces; if (id && !selected.length) throw new Error(`Workspace not found: ${id}`);
    const state = operations(config);
    return print({ version: "1.0", manifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint, oauthScopes: ["queqiao:access"], publicTools: state.tools.filter((tool) => tool.visibility === "public").map((tool) => tool.name), workspaces: selected.map(({ root: _root, ...entry }) => entry), note: "OAuth authenticates the connector only. Workspace policy remains Worker-authoritative." });
  }
  if (domain === "manifest" && action === "show") {
    const config = await configStore.read(); const state = operations(config);
    return print({ ok: state.ok, coreManifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint, supportedMcpProtocolVersions: state.supportedMcpProtocolVersions, manifest: state.ok ? buildDeploymentManifest({ coreManifestRevision: state.coreManifestRevision, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }) : null, ...(state.compositionFailure ? { compositionFailure: state.compositionFailure } : {}) });
  }
  if (domain === "tool" && action === "explain") {
    const toolName = toolNameSchema.parse(leafArgs?.positionals[0] || (typeof leafArgs?.options.tool === "string" ? leafArgs.options.tool : undefined)); const state = operations(await configStore.read()); const explanation = explainTool(state, toolName); if (!explanation) throw new Error(`Tool not found in effective composition: ${toolName}`); return print({ ...explanation, coreManifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint });
  }
  if ((domain === "gateway" || domain === "worker") && action === "stop") return print(await stopRuntime(layout, domain, selectedRoleName!));
  if ((domain === "gateway" || domain === "worker") && action === "status") return print(await runtimeStatus(configFile, layout, domain, selectedRoleName!));
  if ((domain === "gateway" || domain === "worker") && action === "serve") return print(args.includes("--bg") ? await startRuntime(configFile, layout, domain, selectedRoleName!) : await serveRuntime(configFile, domain, selectedRoleName!));
  if (domain === "migrate" && action === "from-repo") return print(await migrateFromRepository(path.resolve(option(args, "repo") || process.cwd()), layout, args.includes("--execute")));
  if (domain === "migrate" && action === "runtime-v1") return print(await migrateRuntimeLayoutV1(layout, args.includes("--execute")));
  throw new Error(USAGE);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = typeof error === "object" && error && "exitCode" in error ? Number(error.exitCode) : 1;
  process.stderr.write(rawArgs.includes("--json")
    ? `${JSON.stringify({ schemaVersion: "1.0", error: { message, exitCode } })}\n`
    : `${message}\n`);
  process.exitCode = exitCode;
});
