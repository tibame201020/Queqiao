import path from "node:path";
import { z } from "zod";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig } from "@queqiao/config";
import { toolNameSchema } from "@queqiao/contracts";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS } from "@queqiao/mcp-compat";
import { buildDeploymentManifest, buildOperationsDiagnostics, explainTool } from "@queqiao/operations";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { migrateFromRepository, migrateRuntimeLayoutV1 } from "./runtime-migration.js";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";
import { createJoinToken, joinWorker, listJoinedWorkers, removeJoinedWorker, setupGateway, setupWorker, updateJoinedWorkerTransport } from "./enrollment-cli.js";
import { doctorGateway } from "./doctor.js";

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
function newWorkspace(id: string, displayName: string, root: string) { return workspaceConfigSchema.parse({ id, displayName, root, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }); }
function operations(config: RuntimeConfig) { return buildOperationsDiagnostics({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, workerProtocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, supportedMcpProtocolVersions: QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions }); }

const args = process.argv.slice(2);
const domain = args[0];
const action = args[1];
const layout = resolveRuntimeLayout();
const configFile = path.resolve(option(args, "file") || layout.configFile);
const configStore = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));

async function main() {
  if (domain === "gateway" && action === "setup") return print(await setupGateway(configFile, args, layout.gatewayStateDir, layout.secretsDir));
  if (domain === "worker" && action === "setup") return print(await setupWorker(configFile, args, layout.secretsDir));
  if (domain === "gateway" && action === "join-token") return print(await createJoinToken(configFile, args));
  if (domain === "worker" && action === "join") return print(await joinWorker(configFile, args));
  if (domain === "worker" && action === "list") return print(await listJoinedWorkers(configFile));
  if (domain === "worker" && action === "update") return print(await updateJoinedWorkerTransport(configFile, requiredOption(args, "worker-id"), requiredOption(args, "endpoint")));
  if (domain === "worker" && action === "remove") return print(await removeJoinedWorker(configFile, requiredOption(args, "worker-id")));
  if (domain === "config" && action === "init") throw new Error("config init is deprecated: use gateway setup and/or worker setup explicitly");
  if (domain === "workspace" && action === "list") return print({ ...(await configStore.metadata()), workspaces: (await configStore.read()).workspaces });
  if (domain === "workspace" && action === "init") {
    const id = requiredOption(args, "id"); const displayName = option(args, "name") || id; const root = await resolveWorkspaceAuthorityRoot(requiredOption(args, "root"));
    const config = await configStore.initialize(runtimeConfigSchema.parse({ version: 1, workspaces: [newWorkspace(id, displayName, root)] }));
    return print({ initialized: true, file: configFile, workspaces: config.workspaces });
  }
  if (domain === "workspace" && action === "add") {
    const id = requiredOption(args, "id"); const displayName = option(args, "name") || id; const root = await resolveWorkspaceAuthorityRoot(requiredOption(args, "root"));
    const config = await configStore.update((current) => { if (current.workspaces.some((entry) => entry.id === id)) throw new Error(`Workspace already exists: ${id}`); return { ...current, workspaces: [...current.workspaces, newWorkspace(id, displayName, root)] }; }); const workspaces = config.workspaces;
    return print({ changed: true, workspace: id, workspaces });
  }
  if (domain === "workspace" && (action === "discover" || action === "approve")) {
    throw new Error(`workspace ${action} is deprecated: repository discovery does not grant Workspace authority; use workspace add --id <id> --root <directory> for an explicit authority grant`);
  }
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
  if (domain === "environment") throw new Error("environment commands are deprecated: use worker join|list|update|remove for Gateway membership management");
  if (domain === "discovery" && action === "list") {
    const discovery = (await configStore.read()).discovery;
    return print({ ...(await configStore.metadata()), discovery, note: "Discovery roots are read-only resource search scopes. They never create or broaden Workspace authority." });
  }
  if (domain === "discovery" && (action === "add" || action === "remove")) {
    const root = await realpathDirectory(requiredOption(args, "root"));
    const config = await configStore.update((current) => ({ ...current, discovery: { ...current.discovery, roots: action === "add" ? unique([...current.discovery.roots, root]) : current.discovery.roots.filter((entry) => path.resolve(entry) !== root) } }));
    return print({ changed: true, decision: action, root, discovery: config.discovery, note: "Discovery roots are read-only resource search scopes. They never create or broaden Workspace authority." });
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
  if (domain === "extension" && action === "list") { const state = operations(await configStore.read()); return print({ ok: state.ok, extensions: state.extensions }); }
  if (domain === "extension" && action === "doctor") { const state = operations(await configStore.read()); return print({ ok: state.ok, extensions: state.extensions, ...(state.compositionFailure ? { compositionFailure: state.compositionFailure } : {}) }); }
  if (domain === "tool" && action === "explain") {
    const toolName = toolNameSchema.parse(args[2] || option(args, "tool")); const state = operations(await configStore.read()); const explanation = explainTool(state, toolName); if (!explanation) throw new Error(`Tool not found in effective composition: ${toolName}`); return print({ ...explanation, coreManifestRevision: state.coreManifestRevision, deploymentManifestFingerprint: state.deploymentManifestFingerprint });
  }
  if (domain === "doctor") {
    const config = await configStore.read(); const state = operations(config); const doctor = await doctorGateway(config);
    return print({ ...state, ...doctor, ok: state.ok && doctor.ok });
  }
  if (domain === "config" && action === "paths") return print(layout);
  if (domain === "migrate" && action === "from-repo") return print(await migrateFromRepository(path.resolve(option(args, "repo") || process.cwd()), layout, args.includes("--execute")));
  if (domain === "migrate" && action === "runtime-v1") return print(await migrateRuntimeLayoutV1(layout, args.includes("--execute")));
  throw new Error("Usage: queqiao gateway setup|join-token, worker setup|join|list|update|remove, config paths, workspace init|list|add|remove, discovery list|add|remove, profile set, tool allow|deny|explain, command allow|deny, permissions show, manifest show, extension list|doctor, doctor");
}

async function realpathDirectory(value: string): Promise<string> {
  const resolved = path.resolve(value);
  const info = await import("node:fs/promises").then(({ stat }) => stat(resolved));
  if (!info.isDirectory()) throw new Error(`Discovery root is not a directory: ${resolved}`);
  return import("node:fs/promises").then(({ realpath }) => realpath(resolved));
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
