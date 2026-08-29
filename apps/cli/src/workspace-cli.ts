import path from "node:path";
import { intro, isCancel, outro, cancel } from "@clack/prompts";
import { workspacePath } from "./workspace-path-prompt.js";
import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig, type WorkspaceConfig } from "@queqiao/config";
import { toolNameSchema } from "@queqiao/contracts";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { accessConfigurationToWorkspacePolicy } from "./access-configuration.js";
import { collectAccessConfiguration, type AccessConfigurationPrompts } from "./access-configuration-flow.js";
import { createAccessConfigurationPrompts } from "./access-configuration-prompts.js";
import { AccessProfileStore, resolveAccessProfileFile } from "./access-profile-store.js";
import { resolveWorkspaceAuthorityRoot, workspaceRootsEqual } from "./workspace-authority.js";
import { secureRuntimeFile } from "./secure-runtime-paths.js";

export type WorkspacePrompt = (message: string) => Promise<string>;
export type WorkspaceProfile = "read-only" | "editor" | "coding";
export type WorkspaceAnswers = { root: string; displayName: string; profile: WorkspaceProfile };

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
}

function requiredOption(args: string[], name: string): string {
  const value = option(args, name);
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

function unique<T>(values: T[]): T[] {
  return [...new Set(values)];
}

export function suggestedWorkspaceId(root: string): string {
  let value = path.win32.basename(root).trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!value) value = "workspace";
  if (!/^[a-z]/.test(value)) value = `workspace-${value}`;
  return value;
}

export function uniqueWorkspaceId(root: string, existingIds: Iterable<string>): string {
  const base = suggestedWorkspaceId(root);
  const used = new Set(existingIds);
  if (!used.has(base)) return base;
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

export function parseWorkspaceProfile(value: string | undefined): WorkspaceProfile {
  const normalized = (value || "read-only").trim().toLowerCase();
  if (normalized === "1" || normalized === "read-only" || normalized === "readonly") return "read-only";
  if (normalized === "2" || normalized === "editor") return "editor";
  if (normalized === "3" || normalized === "coding") return "coding";
  throw new Error("Profile must be 1/read-only, 2/editor, or 3/coding");
}

export function workspaceConfigFromAnswers(answers: WorkspaceAnswers, id = suggestedWorkspaceId(answers.root)): WorkspaceConfig {
  return workspaceConfigSchema.parse({
    id,
    displayName: answers.displayName,
    root: answers.root,
    profile: answers.profile,
    tools: { allow: [], deny: [], explicit: [] },
    commands: { allow: [] },
  });
}

function assertNotCancelled<T>(value: T | symbol): T {
  if (!isCancel(value)) return value as T;
  cancel("Workspace setup cancelled");
  throw new Error("Workspace setup cancelled");
}

type InteractiveWorkspaceCandidate = {
  root: string;
  displayName: string;
  profile: WorkspaceProfile;
  tools: WorkspaceConfig["tools"];
  commands: WorkspaceConfig["commands"];
};

async function interactiveWorkspaceCandidate(options: {
  cwd: string;
  pathPrompt: (cwd: string) => Promise<string | symbol | undefined>;
  prompts: AccessConfigurationPrompts;
  profileStore: Pick<AccessProfileStore, "list" | "save">;
}): Promise<InteractiveWorkspaceCandidate> {
  const rootInput = assertNotCancelled(await options.pathPrompt(options.cwd));
  const root = await resolveWorkspaceAuthorityRoot(String(rootInput || options.cwd));
  const suggested = path.basename(root) || suggestedWorkspaceId(root);
  const displayName = await options.prompts.text("Display name", suggested);
  const configuration = await collectAccessConfiguration(options.prompts, options.profileStore);
  const policy = accessConfigurationToWorkspacePolicy(configuration);
  return {
    root,
    displayName,
    profile: policy.profile as WorkspaceProfile,
    tools: policy.tools,
    commands: policy.commands,
  };
}

async function testPromptAnswers(prompt: WorkspacePrompt): Promise<WorkspaceAnswers> {
  const cwd = process.cwd();
  const rootInput = (await prompt(`Workspace path [${cwd}]: `)).trim() || cwd;
  const root = await resolveWorkspaceAuthorityRoot(rootInput);
  const suggestedName = path.basename(root) || suggestedWorkspaceId(root);
  const displayName = (await prompt(`Display name [${suggestedName}]: `)).trim() || suggestedName;
  const profile = parseWorkspaceProfile((await prompt("Profile [1=read-only, 2=editor, 3=coding] (1): ")).trim());
  return { root, displayName, profile };
}

export async function addWorkspace(configFile: string, args: string[], prompt?: WorkspacePrompt): Promise<unknown> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const current = await store.read();
  if (!current.worker) throw new Error("Worker setup is required before adding a Workspace");

  if (option(args, "id")) throw new Error("--id is no longer supported; Workspace IDs are generated automatically");
  const scripted = option(args, "root") || option(args, "display-name") || option(args, "profile");
  let answers: WorkspaceAnswers;
  let interactivePolicy: Pick<WorkspaceConfig, "tools" | "commands"> | undefined;

  if (scripted) {
    const rootInput = option(args, "root");
    if (!rootInput) throw new Error("--root is required when using non-interactive workspace options");
    const root = await resolveWorkspaceAuthorityRoot(rootInput);
    const displayName = option(args, "display-name") || path.basename(root) || suggestedWorkspaceId(root);
    answers = { root, displayName, profile: parseWorkspaceProfile(option(args, "profile")) };
  } else if (prompt) {
    answers = await testPromptAnswers(prompt);
  } else {
    intro("Add workspace");
    const prompts = createAccessConfigurationPrompts({ cancelMessage: "Workspace setup cancelled" });
    const profileStore = new AccessProfileStore(resolveAccessProfileFile());
    const candidate = await interactiveWorkspaceCandidate({
      cwd: process.cwd(),
      pathPrompt: workspacePath,
      prompts,
      profileStore,
    });
    answers = { root: candidate.root, displayName: candidate.displayName, profile: candidate.profile };
    interactivePolicy = { tools: candidate.tools, commands: candidate.commands };
  }

  let addedWorkspace: WorkspaceConfig | undefined;
  const next = await store.update((config) => {
    if (!config.worker) throw new Error("Worker setup is required before adding a Workspace");
    if (config.workspaces.some((entry) => workspaceRootsEqual(entry.root, answers.root))) {
      throw new Error(`Workspace path is already authorized: ${answers.root}`);
    }
    const id = uniqueWorkspaceId(answers.root, config.workspaces.map((entry) => entry.id));
    addedWorkspace = workspaceConfigSchema.parse({
      ...workspaceConfigFromAnswers(answers, id),
      ...(interactivePolicy ?? {}),
    });
    return runtimeConfigSchema.parse({
      ...config,
      workspaces: [...config.workspaces, addedWorkspace],
    });
  });
  await secureRuntimeFile(configFile);
  if (!addedWorkspace) throw new Error("Workspace add did not produce a Workspace");
  if (!prompt && !scripted) outro(`Workspace added: ${addedWorkspace.displayName}`);
  return { added: true, workspace: next.workspaces.find((entry) => entry.id === addedWorkspace?.id) };
}

export type WorkspaceAccessDependencies = {
  interactive?: boolean;
  prompts?: AccessConfigurationPrompts;
  profileStore?: Pick<AccessProfileStore, "list" | "save">;
};

export async function setWorkspaceAccess(
  configFile: string,
  args: string[],
  dependencies: WorkspaceAccessDependencies = {},
): Promise<unknown> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const requestedWorkspaceId = option(args, "workspace");
  const requestedLegacyProfile = option(args, "profile");
  const current = await store.read();

  if (requestedLegacyProfile) {
    if (!requestedWorkspaceId) throw new Error("--workspace is required when using --profile");
    if (!current.workspaces.some((entry) => entry.id === requestedWorkspaceId)) throw new Error(`Workspace not found: ${requestedWorkspaceId}`);
    const profile = parseWorkspaceProfile(requestedLegacyProfile);
    await store.update((config) => runtimeConfigSchema.parse({
      ...config,
      workspaces: config.workspaces.map((entry) => entry.id === requestedWorkspaceId ? { ...entry, profile } : entry),
    }));
    await secureRuntimeFile(configFile);
    return { changed: true, workspaceId: requestedWorkspaceId, profile, mode: "legacy-profile" };
  }

  const injected = Boolean(dependencies.prompts);
  const interactive = dependencies.interactive ?? (injected || Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!interactive) {
    throw new Error("Interactive Workspace access setup requires a terminal. Use --profile read-only|editor|coding for scripted capability-ceiling changes.");
  }

  if (!current.worker) throw new Error("Worker setup is required before changing Workspace access");
  if (!injected) intro("Workspace access");
  const prompts = dependencies.prompts ?? createAccessConfigurationPrompts({ cancelMessage: "Workspace access setup cancelled" });
  let workspaceId = requestedWorkspaceId;
  if (workspaceId) {
    if (!current.workspaces.some((entry) => entry.id === workspaceId)) throw new Error(`Workspace not found: ${workspaceId}`);
  } else {
    workspaceId = await prompts.choose("Workspace", current.workspaces.map((entry) => ({
      value: entry.id,
      label: entry.displayName,
      description: entry.root,
    })));
  }

  const profileStore = dependencies.profileStore ?? new AccessProfileStore(resolveAccessProfileFile());
  const configuration = await collectAccessConfiguration(prompts, profileStore);
  const policy = accessConfigurationToWorkspacePolicy(configuration);
  let updated: WorkspaceConfig | undefined;
  await store.update((config) => runtimeConfigSchema.parse({
    ...config,
    workspaces: config.workspaces.map((entry) => {
      if (entry.id !== workspaceId) return entry;
      updated = workspaceConfigSchema.parse({ ...entry, ...policy });
      return updated;
    }),
  }));
  if (!updated) throw new Error(`Workspace not found: ${workspaceId}`);
  await secureRuntimeFile(configFile);
  if (!injected) outro(`Workspace access updated: ${updated.displayName}`);
  return {
    changed: true,
    workspaceId,
    mode: "access-profile",
    policy: { profile: updated.profile, tools: updated.tools, commands: updated.commands },
  };
}

export async function updateWorkspaceToolPolicy(configFile: string, args: string[]): Promise<unknown> {
  const workspaceId = requiredOption(args, "workspace");
  const tool = toolNameSchema.parse(requiredOption(args, "tool"));
  const decision = args[1];
  if (decision !== "allow" && decision !== "deny") throw new Error("Tool policy decision must be allow or deny");
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const current = await store.read();
  const selected = current.workspaces.find((entry) => entry.id === workspaceId);
  if (!selected) throw new Error(`Workspace not found: ${workspaceId}`);

  if (decision === "deny" && selected.tools.allow.length === 1 && selected.tools.allow[0] === tool) {
    throw new Error("Cannot deny the last explicitly allowed tool because an empty tool allowlist means wildcard access. Apply an Access Profile or Custom matrix instead.");
  }

  let updated: WorkspaceConfig | undefined;
  await store.update((config) => runtimeConfigSchema.parse({
    ...config,
    workspaces: config.workspaces.map((entry) => {
      if (entry.id !== workspaceId) return entry;
      const hadExplicitAllowlist = entry.tools.allow.length > 0;
      const allow = entry.tools.allow.filter((item) => item !== tool);
      const deny = entry.tools.deny.filter((item) => item !== tool);
      const explicit = entry.tools.explicit.filter((item) => item !== tool);
      const nextTools = decision === "allow"
        ? {
            allow: hadExplicitAllowlist ? unique([...allow, tool]) : [],
            deny,
            explicit: tool === "shell" ? unique([...explicit, tool]) : explicit,
          }
        : {
            allow,
            deny: unique([...deny, tool]),
            explicit,
          };
      updated = workspaceConfigSchema.parse({ ...entry, tools: nextTools });
      return updated;
    }),
  }));
  await secureRuntimeFile(configFile);
  return { changed: true, workspaceId, tool, decision, policy: updated!.tools };
}

export async function updateWorkspaceCommandPolicy(configFile: string, args: string[]): Promise<unknown> {
  const workspaceId = requiredOption(args, "workspace");
  const decision = args[1];
  if (decision !== "allow" && decision !== "deny") throw new Error("Command policy decision must be allow or deny");
  const command = requiredOption(args, "command").trim().toLowerCase();
  if (!/^[a-z0-9._+-]+$/.test(command)) throw new Error("Command must be an executable name without path or shell syntax");
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const current = await store.read();
  if (!current.workspaces.some((entry) => entry.id === workspaceId)) throw new Error(`Workspace not found: ${workspaceId}`);

  let updated: WorkspaceConfig | undefined;
  await store.update((config) => runtimeConfigSchema.parse({
    ...config,
    workspaces: config.workspaces.map((entry) => {
      if (entry.id !== workspaceId) return entry;
      const allow = entry.commands.allow.filter((item) => item.toLowerCase() !== command);
      updated = workspaceConfigSchema.parse({
        ...entry,
        commands: { allow: decision === "allow" ? unique([...allow, command]) : allow },
      });
      return updated;
    }),
  }));
  await secureRuntimeFile(configFile);
  return { changed: true, workspaceId, command, decision, policy: updated!.commands };
}

export async function removeWorkspace(configFile: string, workerName: string, workspaceId: string): Promise<unknown> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const next = await store.update((config) => {
    if (!config.worker) throw new Error("Worker setup is required before removing a Workspace");
    const workspace = config.workspaces.find((entry) => entry.id === workspaceId);
    if (!workspace) throw new Error(`Workspace not found: ${workspaceId}`);
    if (config.workspaces.length <= 1) throw new Error(`Worker ${workerName} must retain at least one Workspace`);
    const extensionBlockers = config.extensions
      .filter((extension) => extension.activation.kind === "workspaces" && extension.activation.workspaceIds.some((id) => id === workspaceId))
      .map((extension) => extension.manifest.id);
    if (extensionBlockers.length) throw new Error(`Workspace ${workspaceId} is referenced by Extensions: ${extensionBlockers.join(", ")}. Detach or update those Extensions first.`);
    return runtimeConfigSchema.parse({ ...config, workspaces: config.workspaces.filter((entry) => entry.id !== workspaceId) });
  });
  await secureRuntimeFile(configFile);
  return { changed: true, worker: workerName, removed: workspaceId, workspaces: next.workspaces };
}

export const workspaceCliInternals = {
  suggestedWorkspaceId,
  uniqueWorkspaceId,
  parseProfile: parseWorkspaceProfile,
  workspaceConfigFromAnswers,
  interactiveWorkspaceCandidate,
};
