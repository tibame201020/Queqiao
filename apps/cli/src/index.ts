#!/usr/bin/env node
import path from "node:path";
import { access } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { AtomicJsonStore } from "./atomic-json-store.js";

const managedToolSchema = z.enum(["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "run", "list_directory", "search_text"]);
const workspaceSchema = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_-]*$/),
  displayName: z.string().min(1),
  root: z.string().min(1),
  profile: z.enum(["read-only", "editor", "coding"]).default("read-only"),
  tools: z.object({ allow: z.array(managedToolSchema).default([]), deny: z.array(managedToolSchema).default([]) }).default({ allow: [], deny: [] }),
  commands: z.object({ allow: z.array(z.string().min(1).max(128)).default([]) }).default({ allow: [] }),
});
const workspacesSchema = z.array(workspaceSchema).min(1);
const workerSchema = z.object({ environmentId: z.string().min(1), url: z.url(), token: z.string().min(16) });
const workersSchema = z.array(workerSchema).min(1);

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
function print(value: unknown) { process.stdout.write(`${JSON.stringify(value, null, 2)}\n`); }
function unique<T>(values: T[]): T[] { return [...new Set(values)]; }
function newWorkspace(id: string, displayName: string, root: string) { return { id, displayName, root, profile: "read-only" as const, tools: { allow: [], deny: [] }, commands: { allow: [] } }; }

const args = process.argv.slice(2);
const domain = args[0];
const action = args[1];
const stateDirectory = path.resolve(process.env.QUEQIAO_CONFIG_DIR?.trim() || path.join(process.cwd(), ".queqiao"));
const workspaceFile = path.resolve(option(args, "file") || path.join(stateDirectory, "workspaces.json"));
const workersFile = path.resolve(option(args, "file") || path.join(stateDirectory, "workers.json"));
const workspaceStore = new AtomicJsonStore(workspaceFile, (value) => workspacesSchema.parse(value));
const workerStore = new AtomicJsonStore(workersFile, (value) => workersSchema.parse(value));

async function main() {
  if (domain === "workspace" && action === "list") return print({ ...(await workspaceStore.metadata()), workspaces: await workspaceStore.read() });
  if (domain === "workspace" && action === "init") {
    const id = requiredOption(args, "id"); const displayName = option(args, "name") || id; const root = path.resolve(requiredOption(args, "root")); await access(root);
    const workspaces = await workspaceStore.initialize([newWorkspace(id, displayName, root)]);
    return print({ initialized: true, file: workspaceFile, workspaces });
  }
  if (domain === "workspace" && action === "add") {
    const id = requiredOption(args, "id"); const displayName = option(args, "name") || id; const root = path.resolve(requiredOption(args, "root")); await access(root);
    const workspaces = await workspaceStore.update((current) => { if (current.some((entry) => entry.id === id)) throw new Error(`Workspace already exists: ${id}`); return [...current, newWorkspace(id, displayName, root)]; });
    return print({ changed: true, workspace: id, workspaces });
  }
  if (domain === "workspace" && action === "remove") {
    const id = requiredOption(args, "id");
    const workspaces = await workspaceStore.update((current) => { const next = current.filter((entry) => entry.id !== id); if (next.length === current.length) throw new Error(`Workspace not found: ${id}`); return next; });
    return print({ changed: true, removed: id, workspaces });
  }
  if (domain === "profile" && action === "set") {
    const id = requiredOption(args, "workspace"); const profile = z.enum(["read-only", "editor", "coding"]).parse(requiredOption(args, "profile"));
    const workspaces = await workspaceStore.update((current) => current.map((entry) => entry.id === id ? { ...entry, profile } : entry));
    if (!workspaces.some((entry) => entry.id === id)) throw new Error(`Workspace not found: ${id}`);
    return print({ changed: true, workspaceId: id, profile });
  }
  if (domain === "tool" && (action === "allow" || action === "deny")) {
    const id = requiredOption(args, "workspace"); const tool = managedToolSchema.parse(requiredOption(args, "tool"));
    let found = false;
    const workspaces = await workspaceStore.update((current) => current.map((entry) => { if (entry.id !== id) return entry; found = true; const allow = entry.tools.allow.filter((item) => item !== tool); const deny = entry.tools.deny.filter((item) => item !== tool); return { ...entry, tools: action === "allow" ? { allow: unique([...allow, tool]), deny } : { allow, deny: unique([...deny, tool]) } }; }));
    if (!found) throw new Error(`Workspace not found: ${id}`);
    return print({ changed: true, workspaceId: id, tool, decision: action, policy: workspaces.find((entry) => entry.id === id)?.tools });
  }
  if (domain === "command" && (action === "allow" || action === "deny")) {
    const id = requiredOption(args, "workspace"); const command = requiredOption(args, "command").trim().toLowerCase(); if (!/^[a-z0-9._+-]+$/.test(command)) throw new Error("Command must be an executable name without path or shell syntax");
    let found = false;
    const workspaces = await workspaceStore.update((current) => current.map((entry) => { if (entry.id !== id) return entry; found = true; const allow = entry.commands.allow.filter((item) => item !== command); return { ...entry, commands: { allow: action === "allow" ? unique([...allow, command]) : allow } }; }));
    if (!found) throw new Error(`Workspace not found: ${id}`);
    return print({ changed: true, workspaceId: id, command, decision: action, policy: workspaces.find((entry) => entry.id === id)?.commands });
  }
  if (domain === "environment" && action === "list") {
    const environments = (await workerStore.read()).map(({ token: _token, ...entry }) => entry);
    return print({ ...(await workerStore.metadata()), environments });
  }
  if (domain === "environment" && action === "add") {
    const environmentId = requiredOption(args, "id");
    const url = new URL(requiredOption(args, "url"));
    if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname)) throw new Error("Worker URL must be loopback HTTP in the verified baseline");
    const tokenFile = path.resolve(requiredOption(args, "token-file"));
    const token = (await readFile(tokenFile, "utf8")).trim();
    if (token.length < 32) throw new Error("Worker token file must contain at least 32 characters");
    const environments = await workerStore.update((current) => { if (current.some((entry) => entry.environmentId === environmentId)) throw new Error(`Environment already exists: ${environmentId}`); return [...current, { environmentId, url: url.href, token }]; });
    return print({ changed: true, environmentId, environments: environments.map(({ token: _token, ...entry }) => entry) });
  }
  if (domain === "environment" && action === "remove") {
    const environmentId = requiredOption(args, "id");
    const environments = await workerStore.update((current) => { const next = current.filter((entry) => entry.environmentId !== environmentId); if (next.length === current.length) throw new Error(`Environment not found: ${environmentId}`); return next; });
    return print({ changed: true, removed: environmentId, environments: environments.map(({ token: _token, ...entry }) => entry) });
  }
  if (domain === "permissions" && action === "show") {
    const id = option(args, "workspace"); const workspaces = await workspaceStore.read(); const selected = id ? workspaces.filter((entry) => entry.id === id) : workspaces; if (id && !selected.length) throw new Error(`Workspace not found: ${id}`);
    return print({ version: "1.0", manifestRevision: 3, oauthScopes: ["queqiao:access"], publicTools: ["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "run", "list_directory", "search_text"], workspaces: selected.map(({ root: _root, ...entry }) => entry), note: "OAuth authenticates the connector only. run requires a coding profile plus an allowlisted executable and never invokes a shell." });
  }
  if (domain === "doctor") {
    const environments = await Promise.all((await workerStore.read()).map(async (entry) => { try { const response = await fetch(new URL("/health", entry.url), { signal: AbortSignal.timeout(3000) }); return { environmentId: entry.environmentId, online: response.ok, status: response.status }; } catch (error) { return { environmentId: entry.environmentId, online: false, error: error instanceof Error ? error.message : "Unknown error" }; } }));
    return print({ ok: environments.some((entry) => entry.online), environments });
  }
  throw new Error("Usage: queqiao workspace init|list|add|remove, environment list|add|remove, profile set, tool allow|deny, command allow|deny, permissions show, doctor");
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : error}\n`); process.exitCode = 1; });
