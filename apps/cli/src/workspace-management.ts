import path from "node:path";
import { confirm, intro, isCancel, outro, cancel } from "@clack/prompts";
import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig, type WorkspaceConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { AccessProfileStore, resolveAccessProfileFile, type AccessProfile } from "./access-profile-store.js";
import { BUILTIN_ACCESS_PROFILES, accessConfigurationToWorkspacePolicy, type AccessConfiguration } from "./access-configuration.js";
import { collectAccessConfiguration, collectCustomAccessConfiguration } from "./access-configuration-flow.js";
import { createAccessConfigurationPrompts } from "./access-configuration-prompts.js";
import { workspacePath } from "./workspace-path-prompt.js";
import { resolveWorkspaceAuthorityRoot, workspaceRootsEqual } from "./workspace-authority.js";
import { secureRuntimeFile } from "./secure-runtime-paths.js";
import { queqiaoSelect } from "./tui-select.js";
import { addWorkspace, removeWorkspace } from "./workspace-cli.js";
import { resolveRoleInstance } from "./instance-selector.js";
import { resolveRuntimeLayoutForNamedRole } from "@queqiao/platform-paths";

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(args: readonly string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function isInteractive(args: readonly string[]): boolean {
  return Boolean(process.stdin.isTTY && process.stdout.isTTY && !args.includes("--json"));
}

async function choose(message: string, choices: Array<{ value: string; label: string; description?: string }>): Promise<string> {
  const value = await queqiaoSelect({ message, choices });
  if (isCancel(value)) {
    cancel(`${message} selection cancelled`);
    const error = new Error(`${message} selection cancelled`) as Error & { exitCode?: number };
    error.exitCode = 130;
    throw error;
  }
  return String(value);
}

async function approve(message: string): Promise<boolean> {
  const value = await confirm({ message, initialValue: false });
  if (isCancel(value)) {
    cancel("Workspace management cancelled");
    const error = new Error("Workspace management cancelled") as Error & { exitCode?: number };
    error.exitCode = 130;
    throw error;
  }
  return Boolean(value);
}

function workspaceSummary(workspace: WorkspaceConfig) {
  return {
    id: workspace.id,
    displayName: workspace.displayName,
    root: workspace.root,
    access: {
      mode: workspace.tools.allow.length ? "explicit" : "legacy-wildcard",
      capabilityCeiling: workspace.profile,
      tools: workspace.tools.allow.length ? workspace.tools.allow : "all-normal-tools-within-capability-ceiling",
      explicitTools: workspace.tools.explicit,
      deniedTools: workspace.tools.deny,
      allowedExecutables: workspace.commands.allow,
      stepUpRules: workspace.stepUp,
    },
  };
}

async function readWorkerConfig(configFile: string): Promise<RuntimeConfig> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const config = await store.read();
  if (!config.worker) throw new Error("Worker setup is required before managing Workspaces");
  return config;
}

async function resolveWorkspaceId(configFile: string, args: readonly string[]): Promise<string> {
  const requested = option(args, "workspace");
  const config = await readWorkerConfig(configFile);
  if (requested) {
    if (!config.workspaces.some((entry) => entry.id === requested)) throw new Error(`Workspace not found: ${requested}`);
    return requested;
  }
  if (!isInteractive(args)) throw new Error('--workspace is required outside an interactive terminal. Run "queqiao workspace list --worker <worker>".');
  return choose("Workspace", config.workspaces.map((entry) => ({ value: entry.id, label: entry.displayName, description: entry.root })));
}

function builtinConfiguration(name: string): AccessConfiguration | undefined {
  const key = name.trim().toLowerCase();
  const profile = BUILTIN_ACCESS_PROFILES.find((entry) => entry.name.toLowerCase() === key || entry.id === key);
  return profile ? { tools: [...profile.configuration.tools], allowedExecutables: [...profile.configuration.allowedExecutables] } : undefined;
}

function builtinProfileName(name: string): string | undefined {
  const key = name.trim().toLowerCase();
  return BUILTIN_ACCESS_PROFILES.find((entry) => entry.name.toLowerCase() === key || entry.id === key)?.name;
}

function assertCustomProfileName(name: string): void {
  const builtin = builtinProfileName(name);
  if (builtin) throw new Error(`Built-in Access Profile ${builtin} is immutable; choose a different custom profile name.`);
}

async function namedProfileConfiguration(name: string, store: AccessProfileStore): Promise<AccessConfiguration> {
  const builtin = builtinConfiguration(name);
  if (builtin) return builtin;
  const profile = await store.get(name);
  if (!profile) throw new Error(`Access profile not found: ${name}`);
  return { tools: [...profile.tools], allowedExecutables: [...profile.allowedExecutables] };
}

export async function listManagedWorkspaces(configFile: string): Promise<unknown> {
  const config = await readWorkerConfig(configFile);
  return { schemaVersion: "1.0", workspaces: config.workspaces.map(workspaceSummary) };
}

export async function getManagedWorkspaceInfo(configFile: string, args: readonly string[]): Promise<unknown> {
  const workspaceId = await resolveWorkspaceId(configFile, args);
  const config = await readWorkerConfig(configFile);
  return { schemaVersion: "1.0", workspace: workspaceSummary(config.workspaces.find((entry) => entry.id === workspaceId)!) };
}

export async function editManagedWorkspace(configFile: string, args: string[]): Promise<unknown> {
  const workspaceId = await resolveWorkspaceId(configFile, args);
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const current = await store.read();
  const selected = current.workspaces.find((entry) => entry.id === workspaceId)!;
  const scripted = Boolean(option(args, "root") || option(args, "display-name") || option(args, "access-profile"));
  let root = selected.root;
  let displayName = selected.displayName;
  let policy: Pick<WorkspaceConfig, "profile" | "tools" | "commands"> | undefined;

  if (scripted) {
    if (option(args, "root")) root = await resolveWorkspaceAuthorityRoot(option(args, "root")!);
    if (option(args, "display-name")) displayName = option(args, "display-name")!.trim();
    if (!displayName) throw new Error("Workspace display name is required");
    if (option(args, "access-profile")) {
      const configuration = await namedProfileConfiguration(option(args, "access-profile")!, new AccessProfileStore(resolveAccessProfileFile()));
      policy = accessConfigurationToWorkspacePolicy(configuration);
    }
  } else {
    if (!isInteractive(args)) throw new Error("Workspace edit requires --root, --display-name, or --access-profile outside an interactive terminal.");
    intro(`Edit Workspace: ${selected.displayName}`);
    const action = await choose("Edit", [
      { value: "identity", label: "Identity", description: "Workspace path and display name" },
      { value: "access", label: "Access", description: "Access Profile or Custom tools/commands" },
    ]);
    if (action === "identity") {
      const selectedRoot = await workspacePath(selected.root);
      if (isCancel(selectedRoot)) throw new Error("Workspace edit cancelled");
      root = await resolveWorkspaceAuthorityRoot(String(selectedRoot || selected.root));
      const prompts = createAccessConfigurationPrompts({ cancelMessage: "Workspace edit cancelled" });
      displayName = await prompts.text("Display name", selected.displayName);
    } else {
      const prompts = createAccessConfigurationPrompts({ cancelMessage: "Workspace edit cancelled" });
      const configuration = await collectAccessConfiguration(prompts, new AccessProfileStore(resolveAccessProfileFile()));
      policy = accessConfigurationToWorkspacePolicy(configuration);
    }
  }

  if (current.workspaces.some((entry) => entry.id !== workspaceId && workspaceRootsEqual(entry.root, root))) {
    throw new Error(`Workspace path is already authorized: ${root}`);
  }
  let updated: WorkspaceConfig | undefined;
  await store.update((config) => runtimeConfigSchema.parse({
    ...config,
    workspaces: config.workspaces.map((entry) => {
      if (entry.id !== workspaceId) return entry;
      updated = workspaceConfigSchema.parse({ ...entry, root, displayName, ...(policy ?? {}) });
      return updated;
    }),
  }));
  await secureRuntimeFile(configFile);
  if (!scripted) outro(`Workspace updated: ${updated!.displayName}`);
  return { changed: true, workspace: workspaceSummary(updated!) };
}

export async function listAccessProfiles(): Promise<unknown> {
  const custom = await new AccessProfileStore(resolveAccessProfileFile()).list();
  return {
    schemaVersion: "1.0",
    profiles: [
      ...BUILTIN_ACCESS_PROFILES.map((profile) => ({ name: profile.name, builtin: true, tools: profile.configuration.tools, allowedExecutables: profile.configuration.allowedExecutables })),
      ...custom.map((profile) => ({ ...profile, builtin: false })),
    ],
    semantics: "Profiles are reusable templates. Applying a profile copies its policy to a Workspace; later profile changes do not modify existing Workspaces.",
  };
}

async function resolveCustomProfileName(args: readonly string[], message = "Access profile"): Promise<string> {
  const requested = option(args, "profile");
  const store = new AccessProfileStore(resolveAccessProfileFile());
  const profiles = await store.list();
  if (requested) {
    const builtin = builtinProfileName(requested);
    if (builtin) throw new Error(`Built-in Access Profile ${builtin} is immutable. Create a custom profile to customize access.`);
    if (!profiles.some((entry) => entry.name.toLowerCase() === requested.toLowerCase())) throw new Error(`Access profile not found: ${requested}`);
    return profiles.find((entry) => entry.name.toLowerCase() === requested.toLowerCase())!.name;
  }
  if (!isInteractive(args)) throw new Error("--profile is required outside an interactive terminal");
  if (!profiles.length) throw new Error("No custom Access Profiles exist. Create one first.");
  return choose(message, profiles.map((profile) => ({ value: profile.name, label: profile.name })));
}

function parseList(value: string | undefined): string[] {
  return (value || "").split(",").map((item) => item.trim()).filter(Boolean);
}

export async function getAccessProfileInfo(args: readonly string[]): Promise<unknown> {
  const requested = option(args, "profile");
  if (requested) {
    const builtin = BUILTIN_ACCESS_PROFILES.find((entry) => entry.name.toLowerCase() === requested.toLowerCase() || entry.id === requested.toLowerCase());
    if (builtin) return { schemaVersion: "1.0", profile: { name: builtin.name, builtin: true, tools: builtin.configuration.tools, allowedExecutables: builtin.configuration.allowedExecutables } };
  }
  const name = await resolveCustomProfileName(args);
  const profile = await new AccessProfileStore(resolveAccessProfileFile()).get(name);
  return { schemaVersion: "1.0", profile: { ...profile!, builtin: false } };
}

export async function createAccessProfile(args: readonly string[]): Promise<unknown> {
  const store = new AccessProfileStore(resolveAccessProfileFile());
  let profile: AccessProfile;
  if (option(args, "name") || option(args, "tools") || option(args, "commands")) {
    const name = requiredOption(args, "name");
    assertCustomProfileName(name);
    if (await store.get(name)) throw new Error(`Access profile already exists: ${name}`);
    profile = { name, tools: parseList(requiredOption(args, "tools")) as AccessProfile["tools"], allowedExecutables: parseList(option(args, "commands")) };
  } else {
    if (!isInteractive(args)) throw new Error("Access profile create requires --name and --tools outside an interactive terminal");
    intro("Create Access Profile");
    const prompts = createAccessConfigurationPrompts({ cancelMessage: "Access profile create cancelled" });
    const name = await prompts.text("Profile name");
    assertCustomProfileName(name);
    if (await store.get(name)) throw new Error(`Access profile already exists: ${name}`);
    const configuration = await collectCustomAccessConfiguration(prompts);
    profile = { name, tools: [...configuration.tools], allowedExecutables: [...configuration.allowedExecutables] };
  }
  await store.save(profile);
  return { created: true, profile: await store.get(profile.name), note: "Applying this profile copies its policy; existing Workspaces are not linked to it." };
}

export async function editAccessProfile(args: readonly string[]): Promise<unknown> {
  const store = new AccessProfileStore(resolveAccessProfileFile());
  const name = await resolveCustomProfileName(args);
  const current = (await store.get(name))!;
  let next: AccessProfile;
  if (option(args, "tools") || option(args, "commands")) {
    next = {
      ...current,
      tools: option(args, "tools") ? parseList(option(args, "tools")) as AccessProfile["tools"] : current.tools,
      allowedExecutables: option(args, "commands") ? parseList(option(args, "commands")) : current.allowedExecutables,
    };
  } else {
    if (!isInteractive(args)) throw new Error("Access profile edit requires --tools or --commands outside an interactive terminal");
    intro(`Edit Access Profile: ${name}`);
    const prompts = createAccessConfigurationPrompts({ cancelMessage: "Access profile edit cancelled" });
    const configuration = await collectCustomAccessConfiguration(prompts);
    next = { name, tools: [...configuration.tools], allowedExecutables: [...configuration.allowedExecutables] };
  }
  await store.save(next);
  return { changed: true, profile: await store.get(name), affectedWorkspaces: 0, note: "Existing Workspaces are unchanged because profiles are templates, not live links." };
}

export async function renameAccessProfile(args: readonly string[]): Promise<unknown> {
  const store = new AccessProfileStore(resolveAccessProfileFile());
  const name = await resolveCustomProfileName(args);
  let nextName = option(args, "to");
  if (!nextName) {
    if (!isInteractive(args)) throw new Error("--to is required outside an interactive terminal");
    nextName = await createAccessConfigurationPrompts({ cancelMessage: "Access profile rename cancelled" }).text("New profile name", name);
  }
  assertCustomProfileName(nextName);
  const renamed = await store.rename(name, nextName);
  return { changed: true, from: name, profile: renamed, affectedWorkspaces: 0, note: "Existing Workspaces are unchanged because profiles are templates, not live links." };
}

export async function deleteAccessProfile(args: readonly string[]): Promise<unknown> {
  const store = new AccessProfileStore(resolveAccessProfileFile());
  const name = await resolveCustomProfileName(args);
  if (!args.includes("--force")) {
    if (!isInteractive(args)) throw new Error("--force is required to delete an Access Profile outside an interactive terminal");
    if (!await approve(`Delete Access Profile ${name}? Existing Workspaces will remain unchanged.`)) return { deleted: false, cancelled: true, profile: name };
  }
  const deleted = await store.delete(name);
  return { deleted: true, profile: deleted.name, affectedWorkspaces: 0, note: "Existing Workspaces remain unchanged." };
}

export async function runWorkspaceManager(args: string[]): Promise<unknown> {
  if (!isInteractive(args)) throw new Error('"queqiao workspace" requires an interactive terminal. Use a workspace or profiles subcommand for automation.');
  intro("Workspace Management");
  const area = await choose("Manage", [
    { value: "workers", label: "Workers", description: "Manage a Worker and its Workspaces" },
    { value: "profiles", label: "Access profiles", description: "Reusable access templates" },
  ]);
  if (area === "workers") {
    const workerName = await resolveRoleInstance("worker", args);
    const layout = resolveRuntimeLayoutForNamedRole("worker", workerName);
    const configFile = path.resolve(layout.configFile);
    const config = await readWorkerConfig(configFile);
    const workspaceId = await choose("Workspace", [
      ...config.workspaces.map((entry) => ({ value: entry.id, label: entry.displayName, description: entry.root })),
      { value: "__add__", label: "+ Add Workspace" },
    ]);
    if (workspaceId === "__add__") return addWorkspace(configFile, ["workspace", "add", "--worker", workerName]);
    const selected = config.workspaces.find((entry) => entry.id === workspaceId)!;
    const action = await choose("Action", [
      { value: "info", label: "Info" },
      { value: "edit", label: "Edit" },
      { value: "remove", label: "Remove" },
    ]);
    if (action === "info") return { schemaVersion: "1.0", workspace: workspaceSummary(selected) };
    if (action === "edit") return editManagedWorkspace(configFile, ["workspace", "edit", "--worker", workerName, "--workspace", workspaceId]);
    if (!await approve(`Remove Workspace ${selected.displayName}?`)) return { removed: false, cancelled: true, workspace: selected.id };
    return removeWorkspace(configFile, workerName, workspaceId);
  }

  const store = new AccessProfileStore(resolveAccessProfileFile());
  const profiles = await store.list();
  const selected = await choose("Access profile", [
    ...BUILTIN_ACCESS_PROFILES.map((profile) => ({ value: `builtin:${profile.id}`, label: profile.name, description: "Built-in" })),
    ...profiles.map((profile) => ({ value: `custom:${profile.name}`, label: profile.name, description: "Custom" })),
    { value: "__create__", label: "+ New profile" },
  ]);
  if (selected === "__create__") return createAccessProfile([]);
  if (selected.startsWith("builtin:")) {
    const profile = BUILTIN_ACCESS_PROFILES.find((entry) => `builtin:${entry.id}` === selected)!;
    return { schemaVersion: "1.0", profile: { name: profile.name, builtin: true, tools: profile.configuration.tools, allowedExecutables: profile.configuration.allowedExecutables }, note: "Built-in profiles are immutable. Create a custom profile to customize access." };
  }
  const name = selected.slice("custom:".length);
  const action = await choose("Action", [
    { value: "info", label: "Info" },
    { value: "edit", label: "Edit" },
    { value: "rename", label: "Rename" },
    { value: "delete", label: "Delete" },
  ]);
  const profileArgs = ["--profile", name];
  if (action === "info") return getAccessProfileInfo(profileArgs);
  if (action === "edit") return editAccessProfile(profileArgs);
  if (action === "rename") return renameAccessProfile(profileArgs);
  return deleteAccessProfile(profileArgs);
}
