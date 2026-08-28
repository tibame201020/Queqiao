import path from "node:path";
import { z } from "zod";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { runtimeConfigSchema, type RuntimeConfig } from "@queqiao/config";
import { toolNameSchema } from "@queqiao/contracts";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS } from "@queqiao/mcp-compat";
import { buildDeploymentManifest, buildOperationsDiagnostics, explainTool } from "@queqiao/operations";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import { assertCommandOwnership, resolveCommandLayout } from "./command-layout.js";
import { migrateFromRepository, migrateRuntimeLayoutV1 } from "./runtime-migration.js";

import { createJoinToken, joinWorker, listJoinedWorkers, removeJoinedWorker, setupGateway, setupWorker, updateJoinedWorkerTransport, updateWorkerPort } from "./enrollment-cli.js";
import { doctorPaths, doctorQueqiao } from "./doctor.js";
import { runtimeStatus, serveRuntime, startRuntime, stopRuntime } from "./service-lifecycle.js";
import { addWorkspace } from "./workspace-cli.js";
import { attachExtension, detachExtension, doctorExtensionHub, installNpmExtension, listExtensions, showExtension, uninstallExtension } from "./extension-cli.js";
import { isRemovedCliRoute, normalizeCliArgs, renderCliHelp } from "./command-surface.js";

const managedToolSchema = toolNameSchema;
const workspaceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  displayName: z.string().min(1),
  root: z.string().min(1),
  profile: z.enum(["read-only", "editor", "coding"]).default("read-only"),
  tools: z.object({ allow: z.array(managedToolSchema).default([]), deny: z.array(managedToolSchema).default([]), explicit: z.array(managedToolSchema).default([]) }).default({ allow: [], deny: [], explicit: [] }),
  commands: z.object({ allow: z.array(z.string().min(1).max(128)).default([]) }).default({ allow: [] }),
});

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
function print(value: unknown) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }

function operations(config: RuntimeConfig) { return buildOperationsDiagnostics({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, workerProtocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, supportedMcpProtocolVersions: QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }); }

const rawArgs = process.argv.slice(2);
const helpRequested = rawArgs.includes("--help") || rawArgs.includes("-h");
const args = normalizeCliArgs(rawArgs);
const domain = args[0];
const action = args[1];
const localName = option(args, "name") || "default";
const USAGE = renderCliHelp([]);

const layout = resolveCommandLayout(args);
const configFile = path.resolve(layout.configFile);
const configStore = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));

async function main() {
  if (isRemovedCliRoute(args)) throw new Error(args[1]);
  if (helpRequested) { process.stdout.write(`${renderCliHelp(rawArgs)}\n`); return; }
  assertCommandOwnership(args);
  if (domain === "gateway" && action === "setup") return print(await setupGateway(configFile, args, layout.gatewayStateDir, layout.secretsDir));
  if (domain === "worker" && action === "setup") return print(await setupWorker(configFile, args, layout.secretsDir));
  if (domain === "worker" && action === "port") {
    const status = await runtimeStatus(configFile, layout, "worker", localName);
    if (status.active) throw new Error("Stop the Worker before changing its listener port");
    return print(await updateWorkerPort(configFile, args));
  }
  if (domain === "gateway" && action === "join-token") return print(await createJoinToken(configFile, args));
  if (domain === "worker" && action === "join") return print(await joinWorker(configFile, args));
  if (domain === "worker" && action === "list") return print(await listJoinedWorkers(configFile));
  if (domain === "worker" && action === "update") return print(await updateJoinedWorkerTransport(configFile, requiredOption(args, "worker-id"), requiredOption(args, "endpoint")));
  if (domain === "worker" && action === "remove") return print(await removeJoinedWorker(configFile, requiredOption(args, "worker-id")));
  if (domain === "workspace" && action === "list") { requiredOption(args, "worker"); return print({ ...(await configStore.metadata()), workspaces: (await configStore.read()).workspaces }); }
  if (domain === "workspace" && action === "add") { requiredOption(args, "worker"); return print(await addWorkspace(configFile, args)); }
  if (domain === "workspace" && action === "remove") {
    const id = requiredOption(args, "id");
    const config = await configStore.update((current) => { const next = current.workspaces.filter((entry) => entry.id !== id); if (next.length === current.workspaces.length) throw new Error(`Workspace not found: ${id}`); return { ...current, workspaces: next }; }); const workspaces = config.workspaces;
    return print({ changed: true, removed: id, workspaces });
  }
  if (domain === "profile" && action === "set") {
    const id = requiredOption(args, "workspace"); const profile = z.enum(["read-only", "editor", "coding"]).parse(requiredOption(args, "profile"));
    const config = await configStore.update((current) => ({ ...current, workspaces: current.workspaces.map((entry) => entry.id === id ? { ...entry, profile } : entry) })); const workspaces = config.workspaces;
    if (!workspaces.some((entry) => entry.id === id)) throw new Error(`Workspace not found: ${id}`);
    return print({ changed: true, workspaceId: id, profile });
  }
  if (domain === "tool" && (action === "allow" || action === "deny")) {
    const id = requiredOption(args, "workspace"); const tool = managedToolSchema.parse(requiredOption(args, "tool"));
    let found = false;
    const config = await configStore.update((current) => ({ ...current, workspaces: current.workspaces.map((entry) => { if (entry.id !== id) return entry; found = true; const allow = entry.tools.allow.filter((item) => item !== tool); const deny = entry.tools.deny.filter((item) => item !== tool); const explicit = entry.tools.explicit.filter((item) => item !== tool); if (tool === "shell") return { ...entry, tools: action === "allow" ? { allow, deny, explicit: unique([...explicit, tool]) } : { allow, deny: unique([...deny, tool]), explicit } }; return { ...entry, tools: action === "allow" ? { allow: unique([...allow, tool]), deny, explicit } : { allow, deny: unique([...deny, tool]), explicit } }; }) })); const workspaces = config.workspaces;
    if (!found) throw new Error(`Workspace not found: ${id}`);
    return print({ changed: true, workspaceId: id, tool, decision: action, policy: workspaces.find((entry) => entry.id === id)?.tools });
  }
  if (domain === "command" && (action === "allow" || action === "deny")) {
    const id = requiredOption(args, "workspace"); const command = requiredOption(args, "command").trim().toLowerCase(); if (!/^[a-z0-9._+-]+$/.test(command)) throw new Error("Command must be an executable name without path or shell syntax");
    let found = false;
    const config = await configStore.update((current) => ({ ...current, workspaces: current.workspaces.map((entry) => { if (entry.id !== id) return entry; found = true; const allow = entry.commands.allow.filter((item) => item !== command); return { ...entry, commands: { allow: action === "allow" ? unique([...allow, command]) : allow } }; }) })); const workspaces = config.workspaces;
    if (!found) throw new Error(`Workspace not found: ${id}`);
    return print({ changed: true, workspaceId: id, command, decision: action, policy: workspaces.find((entry) => entry.id === id)?.commands });
  }
  if (domain === "permissions" && action === "show") {
    const config = await configStore.read(); const id = option(args, "workspace"); const selected = id ? config.workspaces.filter((entry) => entry.id === id) : config.workspaces; if (id && !selected.length) throw new Error(`Workspace not found: ${id}`);
    const state = operations(config);
    return print({ version: "1.0", manifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint, oauthScopes: ["queqiao:access"], publicTools: state.tools.filter((tool) => tool.visibility === "public").map((tool) => tool.name), workspaces: selected.map(({ root: _root, ...entry }) => entry), note: "OAuth authenticates the connector only. Workspace policy remains Worker-authoritative." });
  }
  if (domain === "manifest" && action === "show") {
    const config = await configStore.read(); const state = operations(config);
    return print({ ok: state.ok, coreManifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint, supportedMcpProtocolVersions: state.supportedMcpProtocolVersions, manifest: state.ok ? buildDeploymentManifest({ coreManifestRevision: state.coreManifestRevision, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }) : null, ...(state.compositionFailure ? { compositionFailure: state.compositionFailure } : {}) });
  }
  if (domain === "extension" && action === "install") {
    const source = args[2] || option(args, "source");
    if (!source) throw new Error("Extension source is required, for example: npm:queqiao-mcp");
    const workerName = option(args, "worker");
    return print(await installNpmExtension(layout, source, { ...(workerName ? { workerName } : {}), attachAll: args.includes("--attach-all") }));
  }
  if (domain === "extension" && action === "attach") {
    const id = args[2] || option(args, "id"); if (!id) throw new Error("Extension id is required");
    return print(await attachExtension(layout, id, requiredOption(args, "worker")));
  }
  if (domain === "extension" && action === "detach") {
    const id = args[2] || option(args, "id"); if (!id) throw new Error("Extension id is required");
    return print(await detachExtension(id, requiredOption(args, "worker")));
  }
  if (domain === "extension" && action === "uninstall") {
    const id = args[2] || option(args, "id"); if (!id) throw new Error("Extension id is required");
    return print(await uninstallExtension(layout, id, args.includes("--force")));
  }
  if (domain === "extension" && action === "list") return print(await listExtensions(layout));
  if (domain === "extension" && action === "show") {
    const id = args[2] || option(args, "id"); if (!id) throw new Error("Extension id is required");
    return print(await showExtension(layout, id));
  }
  if (domain === "extension" && action === "doctor") return print(await doctorExtensionHub(layout));
  if (domain === "tool" && action === "explain") {
    const toolName = toolNameSchema.parse(args[2] || option(args, "tool")); const state = operations(await configStore.read()); const explanation = explainTool(state, toolName); if (!explanation) throw new Error(`Tool not found in effective composition: ${toolName}`); return print({ ...explanation, coreManifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint });
  }
  if ((domain === "gateway" || domain === "worker") && action === "stop") return print(await stopRuntime(layout, domain, localName));
  if ((domain === "gateway" || domain === "worker") && action === "status") return print(await runtimeStatus(configFile, layout, domain, localName));
  if ((domain === "gateway" || domain === "worker") && action === "serve") return print(args.includes("--bg") ? await startRuntime(configFile, layout, domain, localName) : await serveRuntime(configFile, domain, localName));
  if (domain === "doctor") return print(await doctorQueqiao());
  if (domain === "config" && action === "paths") return print(doctorPaths());
  if (domain === "migrate" && action === "from-repo") return print(await migrateFromRepository(path.resolve(option(args, "repo") || process.cwd()), layout, args.includes("--execute")));
  if (domain === "migrate" && action === "runtime-v1") return print(await migrateRuntimeLayoutV1(layout, args.includes("--execute")));
  throw new Error(USAGE);
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
