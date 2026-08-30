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
import { createQueqiaoTheme, shouldUseCliColor, styleCliHelpText } from "./tui-theme.js";
import { isCliHelpContext, isRemovedCliRoute, normalizeCliArgs, resolveCliDispatch, renderCliHelp, renderCliRouteError, renderRemovedSelectorError, validateCliArgs } from "./command-surface.js";
import { listRoleInstances, resolveRoleInstance, selectorRoleForCliArgs, withRoleSelector } from "./instance-selector.js";
import { QUEQIAO_CLI_VERSION } from "./version.js";
import { getGatewayInfo } from "./gateway-info.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
function operations(config: RuntimeConfig) { return buildOperationsDiagnostics({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, workerProtocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, supportedMcpProtocolVersions: QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }); }

const rawArgs = process.argv.slice(2);
let outputArgs = rawArgs;
let commandArgs = rawArgs.filter((arg) => arg !== "--json");
let dispatch = resolveCliDispatch(commandArgs);
const helpRequested = commandArgs.includes("--help") || commandArgs.includes("-h");
let args = normalizeCliArgs(commandArgs);
let selectedRoleName: string | undefined;
const USAGE = renderCliHelp([]);

function print(value: unknown) { process.stdout.write(`${formatCliOutput(outputArgs, value, { color: shouldUseCliColor() })}\n`); }
function printVersion() {
  if (rawArgs.includes("--json")) process.stdout.write(`${JSON.stringify({ schemaVersion: "1.0", version: QUEQIAO_CLI_VERSION })}\n`);
  else process.stdout.write(`${QUEQIAO_CLI_VERSION}\n`);
}

async function main() {
  if (rawArgs.includes("--version") || rawArgs.includes("-v")) return printVersion();
  if (isRemovedCliRoute(args)) throw new Error(args[1]);
  if (helpRequested) { process.stdout.write(`${styleCliHelpText(renderCliHelp(commandArgs))}\n`); return; }
  if (isCliHelpContext(commandArgs)) { process.stdout.write(`${styleCliHelpText(renderCliHelp(commandArgs))}\n`); return; }
  const selectorError = renderRemovedSelectorError(commandArgs);
  if (selectorError) throw new Error(selectorError);
  const routeError = renderCliRouteError(commandArgs);
  if (routeError) throw new Error(routeError);
  validateCliArgs(commandArgs);

  if (dispatch?.handler === "version") return printVersion();
  if (dispatch?.handler === "list-role-instances" && dispatch.route === "gateway list") return print({ schemaVersion: "1.0", role: "gateway", instances: await listRoleInstances("gateway") });
  if (dispatch?.handler === "list-role-instances" && dispatch.route === "worker list") return print({ schemaVersion: "1.0", role: "worker", instances: await listRoleInstances("worker") });

  const selectorRole = selectorRoleForCliArgs(commandArgs);
  if (selectorRole) {
    selectedRoleName = await resolveRoleInstance(selectorRole, rawArgs);
    outputArgs = withRoleSelector(rawArgs, selectorRole, selectedRoleName);
    if (!commandArgs.includes(`--${selectorRole}`) && !rawArgs.includes("--json") && dispatch?.handler !== "gateway-info") {
      const theme = createQueqiaoTheme(shouldUseCliColor());
      process.stderr.write(`${theme.subtle(`${selectorRole === "gateway" ? "Gateway" : "Worker"}:`)} ${theme.identifier(selectedRoleName)}\n`);
    }
    commandArgs = withRoleSelector(commandArgs, selectorRole, selectedRoleName);
    dispatch = resolveCliDispatch(commandArgs);
    args = normalizeCliArgs(commandArgs);
  }

  assertCommandOwnership(args);
  const route = dispatch?.route;

  if (dispatch?.handler === "role-setup" && route === "gateway setup") return print(await runRoleSetupWizard("gateway", args));
  if (dispatch?.handler === "role-remove" && route === "gateway remove") return print(await removeRoleInstance("gateway", args));
  if (dispatch?.handler === "role-setup" && route === "worker setup") return print(await runRoleSetupWizard("worker", args));
  if (dispatch?.handler === "role-remove" && route === "worker remove") return print(await removeRoleInstance("worker", args));
  if (dispatch?.handler === "uninstall") return print(await uninstallQueqiao(args));

  if (dispatch?.handler === "extension-install") {
    const source = dispatch?.positionals[0] || (typeof dispatch?.options.source === "string" ? dispatch.options.source : undefined);
    if (!source) throw new Error("Extension source is required, for example: npm:queqiao-mcp or .\\my-extension");
    const workerName = option(args, "worker");
    return print(await installExtension(resolveExtensionHubRoot(), source, { ...(workerName ? { workerName } : {}), attachAll: args.includes("--attach-all") }));
  }
  if (dispatch?.handler === "extension-attach") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    return print(await attachExtension(resolveExtensionHubRoot(), id, requiredOption(args, "worker")));
  }
  if (dispatch?.handler === "extension-detach") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    return print(await detachExtension(id, requiredOption(args, "worker")));
  }
  if (dispatch?.handler === "extension-uninstall") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    return print(await uninstallExtension(resolveExtensionHubRoot(), id, args.includes("--force")));
  }
  if (dispatch?.handler === "extension-list") return print(await listExtensions(resolveExtensionHubRoot()));
  if (dispatch?.handler === "extension-show") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    return print(await showExtension(resolveExtensionHubRoot(), id));
  }
  if (dispatch?.handler === "extension-doctor") return print(await doctorExtensionHub(resolveExtensionHubRoot()));
  if (dispatch?.handler === "doctor") return print(await doctorQueqiao());
  if (dispatch?.handler === "doctor-paths") return print(doctorPaths());

  const layout = resolveCommandLayout(args);
  const configFile = path.resolve(layout.configFile);
  const configStore = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));

  if (dispatch?.handler === "gateway-info") return print(await getGatewayInfo(configFile, layout, selectedRoleName!, outputArgs));

  if (dispatch?.handler === "worker-port") {
    const status = await runtimeStatus(configFile, layout, "worker", selectedRoleName!);
    if (status.active) throw new Error("Stop the Worker before changing its listener port");
    return print(await updateWorkerPort(configFile, args));
  }
  if (dispatch?.handler === "gateway-join-token") return print(await createJoinToken(configFile, outputArgs));
  if (dispatch?.handler === "worker-join") return print(await joinWorker(configFile, args));
  if (dispatch?.handler === "membership-list") return print(await listJoinedWorkers(configFile));
  if (dispatch?.handler === "membership-update") return print(await updateJoinedWorkerTransport(configFile, requiredOption(args, "worker-id"), requiredOption(args, "endpoint")));
  if (dispatch?.handler === "membership-remove") return print(await removeJoinedWorker(configFile, requiredOption(args, "worker-id")));
  if (dispatch?.handler === "workspace-list") { requiredOption(args, "worker"); return print({ ...(await configStore.metadata()), workspaces: (await configStore.read()).workspaces }); }
  if (dispatch?.handler === "workspace-add") { requiredOption(args, "worker"); return print(await addWorkspace(configFile, args)); }
  if (dispatch?.handler === "workspace-remove") {
    const id = requiredOption(args, "id"); const workerName = requiredOption(args, "worker");
    return print(await removeWorkspace(configFile, workerName, id));
  }
  if (dispatch?.handler === "workspace-profile-set") return print(await setWorkspaceAccess(configFile, args));
  if (dispatch?.handler === "workspace-tool-policy") return print(await updateWorkspaceToolPolicy(configFile, args));
  if (dispatch?.handler === "workspace-command-policy") return print(await updateWorkspaceCommandPolicy(configFile, args));
  if (dispatch?.handler === "workspace-permissions-show") {
    const config = await configStore.read(); const id = option(args, "workspace"); const selected = id ? config.workspaces.filter((entry) => entry.id === id) : config.workspaces; if (id && !selected.length) throw new Error(`Workspace not found: ${id}`);
    const state = operations(config);
    return print({ version: "1.0", manifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint, oauthScopes: ["queqiao:access"], publicTools: state.tools.filter((tool) => tool.visibility === "public").map((tool) => tool.name), workspaces: selected.map(({ root: _root, ...entry }) => entry), note: "OAuth authenticates the connector only. Workspace policy remains Worker-authoritative." });
  }
  if (dispatch?.handler === "manifest-show") {
    const config = await configStore.read(); const state = operations(config);
    return print({ ok: state.ok, coreManifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint, supportedMcpProtocolVersions: state.supportedMcpProtocolVersions, manifest: state.ok ? buildDeploymentManifest({ coreManifestRevision: state.coreManifestRevision, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }) : null, ...(state.compositionFailure ? { compositionFailure: state.compositionFailure } : {}) });
  }
  if (dispatch?.handler === "tool-explain") {
    const toolName = toolNameSchema.parse(dispatch?.positionals[0] || (typeof dispatch?.options.tool === "string" ? dispatch.options.tool : undefined)); const state = operations(await configStore.read()); const explanation = explainTool(state, toolName); if (!explanation) throw new Error(`Tool not found in effective composition: ${toolName}`); return print({ ...explanation, coreManifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint });
  }
  if (dispatch?.handler === "runtime-stop" && route === "gateway stop") return print(await stopRuntime(layout, "gateway", selectedRoleName!));
  if (dispatch?.handler === "runtime-stop" && route === "worker stop") return print(await stopRuntime(layout, "worker", selectedRoleName!));
  if (dispatch?.handler === "runtime-status" && route === "gateway status") return print(await runtimeStatus(configFile, layout, "gateway", selectedRoleName!));
  if (dispatch?.handler === "runtime-status" && route === "worker status") return print(await runtimeStatus(configFile, layout, "worker", selectedRoleName!));
  if (dispatch?.handler === "runtime-serve" && route === "gateway serve") return print(args.includes("--bg") ? await startRuntime(configFile, layout, "gateway", selectedRoleName!) : await serveRuntime(configFile, "gateway", selectedRoleName!));
  if (dispatch?.handler === "runtime-serve" && route === "worker serve") return print(args.includes("--bg") ? await startRuntime(configFile, layout, "worker", selectedRoleName!) : await serveRuntime(configFile, "worker", selectedRoleName!));
  if (dispatch?.handler === "migrate-from-repo") return print(await migrateFromRepository(path.resolve(option(args, "repo") || process.cwd()), layout, args.includes("--execute")));
  if (dispatch?.handler === "migrate-runtime-v1") return print(await migrateRuntimeLayoutV1(layout, args.includes("--execute")));
  throw new Error(USAGE);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  const exitCode = typeof error === "object" && error && "exitCode" in error ? Number(error.exitCode) : 1;
  const humanMessage = createQueqiaoTheme(shouldUseCliColor()).danger(message);
  process.stderr.write(rawArgs.includes("--json")
    ? `${JSON.stringify({ schemaVersion: "1.0", error: { message, exitCode } })}\n`
    : `${humanMessage}\n`);
  process.exitCode = exitCode;
});
