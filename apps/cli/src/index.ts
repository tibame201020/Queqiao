import path from "node:path";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { runtimeConfigSchema, type RuntimeConfig } from "@queqiao/config";
import { toolNameSchema } from "@queqiao/contracts";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS } from "@queqiao/mcp-compat";
import { buildDeploymentManifest, buildOperationsDiagnostics, explainTool } from "@queqiao/operations";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import { resolveExtensionHubRoot, resolveRuntimeLayout, resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";
import { assertCommandOwnership, resolveCommandLayout } from "./command-layout.js";
import { migrateFromRepository, migrateRuntimeLayoutV1 } from "./runtime-migration.js";
import { createJoinToken, joinWorker, listJoinedWorkers, removeJoinedWorker, updateWorkerPort } from "./enrollment-cli.js";
import { runRoleSetupWizard } from "./setup-wizard.js";
import { removeRoleInstance } from "./role-remove.js";
import { uninstallQueqiao } from "./uninstall-cli.js";
import { doctorPaths, doctorQueqiao } from "./doctor.js";
import { runtimeStatus, serveRuntime, startRuntime, stopRuntime } from "./service-lifecycle.js";
import { addWorkspace, removeWorkspace } from "./workspace-cli.js";
import { createAccessProfile, deleteAccessProfile, editAccessProfile, editManagedWorkspace, getAccessProfileInfo, getManagedWorkspaceInfo, listAccessProfiles, listManagedWorkspaces, renameAccessProfile, runWorkspaceManager } from "./workspace-management.js";
import { attachExtension, detachExtension, doctorExtensionHub, installExtension, listExtensions, resolveInstalledExtensionId, showExtension, uninstallExtension } from "./extension-cli.js";
import { formatCliOutput } from "./cli-output.js";
import { createQueqiaoTheme, shouldUseCliColor, styleCliHelpText } from "./tui-theme.js";
import { isCliHelpContext, isRemovedCliRoute, normalizeCliArgs, resolveCliDispatch, renderCliHelp, renderCliRouteError, renderRemovedSelectorError, validateCliArgs } from "./command-surface.js";
import { listRoleInstances, resolveRoleInstance, selectorRoleForCliArgs, withRoleSelector } from "./instance-selector.js";
import { QUEQIAO_CLI_VERSION } from "./version.js";
import { getGatewayInfo } from "./gateway-info.js";
import { renderShellCompletion } from "./shell-completion.js";
import { runWorkstation } from "./workstation.js";
import { listAuditEvents, recordCliAudit } from "./audit-cli.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
function operations(config: RuntimeConfig) { return buildOperationsDiagnostics({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, workerProtocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, supportedMcpProtocolVersions: QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }); }
function auditDir(stateDir: string): string { return path.join(stateDir, "audit"); }
function resultString(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = (value as Record<string, unknown>)[key];
  return typeof candidate === "string" ? candidate : undefined;
}

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
  if (dispatch?.handler === "completion") {
    const shell = dispatch.positionals[0];
    if (!shell) throw new Error("Shell is required. Expected bash, zsh, or powershell.");
    process.stdout.write(renderShellCompletion(shell));
    return;
  }
  if (dispatch?.handler === "workstation") return runWorkstation(rawArgs);
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
    const result = await installExtension(resolveExtensionHubRoot(), source, { ...(workerName ? { workerName } : {}), attachAll: args.includes("--attach-all") });
    const extensionId = resultString(result, "id");
    await recordCliAudit(auditDir(resolveRuntimeLayout().stateDir), { category: "extension", action: "extension.install", outcome: "success", ...(extensionId ? { subject: { extensionId } } : {}) });
    if (extensionId && result && typeof result === "object" && Array.isArray((result as { attachments?: unknown }).attachments)) {
      for (const attachment of (result as { attachments: unknown[] }).attachments) {
        const attachedWorker = resultString(attachment, "worker");
        if (attachedWorker) await recordCliAudit(auditDir(resolveRuntimeLayoutForNamedRole("worker", attachedWorker).stateDir), { category: "extension", action: "extension.attach", outcome: "success", subject: { extensionId, worker: attachedWorker } });
      }
    }
    return print(result);
  }
  if (dispatch?.handler === "extension-attach") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    const workerName = requiredOption(args, "worker");
    const result = await attachExtension(resolveExtensionHubRoot(), id, workerName);
    await recordCliAudit(auditDir(resolveRuntimeLayoutForNamedRole("worker", workerName).stateDir), { category: "extension", action: "extension.attach", outcome: "success", subject: { extensionId: id, worker: workerName } });
    return print(result);
  }
  if (dispatch?.handler === "extension-detach") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    const workerName = requiredOption(args, "worker");
    const result = await detachExtension(id, workerName);
    await recordCliAudit(auditDir(resolveRuntimeLayoutForNamedRole("worker", workerName).stateDir), { category: "extension", action: "extension.detach", outcome: "success", subject: { extensionId: id, worker: workerName } });
    return print(result);
  }
  if (dispatch?.handler === "extension-uninstall") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    const result = await uninstallExtension(resolveExtensionHubRoot(), id, args.includes("--force"));
    await recordCliAudit(auditDir(resolveRuntimeLayout().stateDir), { category: "extension", action: "extension.uninstall", outcome: "success", subject: { extensionId: id } });
    if (result && typeof result === "object" && Array.isArray((result as { detachedWorkers?: unknown }).detachedWorkers)) {
      for (const detachedWorker of (result as { detachedWorkers: unknown[] }).detachedWorkers) {
        if (typeof detachedWorker === "string") await recordCliAudit(auditDir(resolveRuntimeLayoutForNamedRole("worker", detachedWorker).stateDir), { category: "extension", action: "extension.detach", outcome: "success", subject: { extensionId: id, worker: detachedWorker } });
      }
    }
    return print(result);
  }
  if (dispatch?.handler === "extension-list") return print(await listExtensions(resolveExtensionHubRoot()));
  if (dispatch?.handler === "extension-show") {
    const id = await resolveInstalledExtensionId(resolveExtensionHubRoot(), dispatch?.positionals[0] || (typeof dispatch?.options.id === "string" ? dispatch.options.id : undefined));
    return print(await showExtension(resolveExtensionHubRoot(), id));
  }
  if (dispatch?.handler === "extension-doctor") return print(await doctorExtensionHub(resolveExtensionHubRoot()));
  if (dispatch?.handler === "doctor") return print(await doctorQueqiao());
  if (dispatch?.handler === "doctor-paths") return print(doctorPaths());

  if (dispatch?.handler === "workspace-manager") return print(await runWorkspaceManager(args));
  if (dispatch?.handler === "workspace-profiles-list") return print(await listAccessProfiles());
  if (dispatch?.handler === "workspace-profiles-info") return print(await getAccessProfileInfo(args));
  if (dispatch?.handler === "workspace-profiles-create") return print(await createAccessProfile(args));
  if (dispatch?.handler === "workspace-profiles-edit") return print(await editAccessProfile(args));
  if (dispatch?.handler === "workspace-profiles-rename") return print(await renameAccessProfile(args));
  if (dispatch?.handler === "workspace-profiles-delete") return print(await deleteAccessProfile(args));

  const layout = resolveCommandLayout(args);
  const configFile = path.resolve(layout.configFile);
  if (dispatch?.handler === "audit-list") {
    const result = await listAuditEvents(path.join(layout.stateDir, "audit"), {
      ...(typeof dispatch.options.limit === "string" ? { limit: dispatch.options.limit } : {}),
      ...(typeof dispatch.options.category === "string" ? { category: dispatch.options.category } : {}),
      ...(typeof dispatch.options.outcome === "string" ? { outcome: dispatch.options.outcome } : {}),
      ...(typeof dispatch.options.action === "string" ? { action: dispatch.options.action } : {}),
    });
    const scope = route?.startsWith("gateway") ? "gateway" : route?.startsWith("worker") ? "worker" : "global";
    return print({ ...result, scope, ...(selectedRoleName ? { name: selectedRoleName } : {}) });
  }
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
  if (dispatch?.handler === "membership-remove") return print(await removeJoinedWorker(configFile, requiredOption(args, "worker-id")));
  if (dispatch?.handler === "workspace-list") return print(await listManagedWorkspaces(configFile));
  if (dispatch?.handler === "workspace-add") {
    const workerName = requiredOption(args, "worker");
    const result = await addWorkspace(configFile, args);
    const workspaceId = result && typeof result === "object" && (result as { workspace?: unknown }).workspace && typeof (result as { workspace?: unknown }).workspace === "object"
      ? resultString((result as { workspace: unknown }).workspace, "id")
      : undefined;
    await recordCliAudit(auditDir(layout.stateDir), { category: "workspace", action: "workspace.add", outcome: "success", ...(workspaceId ? { subject: { workspaceId, worker: workerName } } : { subject: { worker: workerName } }) });
    return print(result);
  }
  if (dispatch?.handler === "workspace-info") return print(await getManagedWorkspaceInfo(configFile, args));
  if (dispatch?.handler === "workspace-edit") {
    const workerName = requiredOption(args, "worker");
    const result = await editManagedWorkspace(configFile, args);
    const workspaceId = result && typeof result === "object" && (result as { workspace?: unknown }).workspace && typeof (result as { workspace?: unknown }).workspace === "object"
      ? resultString((result as { workspace: unknown }).workspace, "id")
      : option(args, "workspace");
    await recordCliAudit(auditDir(layout.stateDir), { category: "workspace", action: "workspace.edit", outcome: "success", ...(workspaceId ? { subject: { workspaceId, worker: workerName } } : { subject: { worker: workerName } }) });
    return print(result);
  }
  if (dispatch?.handler === "workspace-remove") {
    const workerName = requiredOption(args, "worker");
    const id = option(args, "workspace") || (await getManagedWorkspaceInfo(configFile, args) as any).workspace.id;
    const result = await removeWorkspace(configFile, workerName, id);
    await recordCliAudit(auditDir(layout.stateDir), { category: "workspace", action: "workspace.remove", outcome: "success", subject: { workspaceId: id, worker: workerName } });
    return print(result);
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
  if (dispatch?.handler === "runtime-serve" && route === "gateway serve") return print(args.includes("--bg") ? await startRuntime(configFile, layout, "gateway", selectedRoleName!) : await serveRuntime(configFile, "gateway", selectedRoleName!, { env: { ...process.env, QUEQIAO_AUDIT_DIR: path.join(layout.stateDir, "audit") } }));
  if (dispatch?.handler === "runtime-serve" && route === "worker serve") return print(args.includes("--bg") ? await startRuntime(configFile, layout, "worker", selectedRoleName!) : await serveRuntime(configFile, "worker", selectedRoleName!, { env: { ...process.env, QUEQIAO_AUDIT_DIR: path.join(layout.stateDir, "audit") } }));
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
