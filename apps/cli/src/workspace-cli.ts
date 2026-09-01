import path from "node:path";
import { intro, isCancel, outro, cancel } from "@clack/prompts";
import { workspacePath } from "./workspace-path-prompt.js";
import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig, type WorkspaceConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { collectAccessConfiguration, resolveNamedAccessConfiguration, type AccessConfigurationPrompts } from "./access-configuration-flow.js";
import { createAccessConfigurationPrompts } from "./access-configuration-prompts.js";
import { AccessProfileStore, resolveAccessProfileFile } from "./access-profile-store.js";
import { accessConfigurationToWorkspacePolicy } from "./access-configuration.js";
import { resolveWorkspaceAuthorityRoot, workspaceRootsEqual } from "./workspace-authority.js";
import { secureRuntimeFile } from "./secure-runtime-paths.js";

export type WorkspacePrompt = (message: string) => Promise<string>;
export type WorkspaceProfile = "read-only" | "editor" | "coding";
export type WorkspaceAnswers = { root: string; displayName: string; profile: WorkspaceProfile };
export type WorkspaceInteractiveDependencies = {
  prompts?: AccessConfigurationPrompts;
  pathPrompt?: (cwd: string) => Promise<string | symbol | undefined>;
  profileStore?: Pick<AccessProfileStore, "list" | "save">;
};

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

export async function addWorkspace(
  configFile: string,
  args: string[],
  prompt?: WorkspacePrompt,
  interactiveDependencies: WorkspaceInteractiveDependencies = {},
): Promise<unknown> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const current = await store.read();
  if (!current.worker) throw new Error("Worker setup is required before adding a Workspace");

  if (option(args, "id")) throw new Error("--id is no longer supported; Workspace IDs are generated automatically");
  if (option(args, "profile")) throw new Error('--profile was removed from Workspace add; use --access-profile <name>.');
  const scripted = option(args, "root") || option(args, "display-name") || option(args, "access-profile");
  let answers: WorkspaceAnswers;
  let interactivePolicy: Pick<WorkspaceConfig, "tools" | "commands"> | undefined;

  if (scripted) {
    const rootInput = option(args, "root");
    if (!rootInput) throw new Error("--root is required when using non-interactive workspace options");
    const root = await resolveWorkspaceAuthorityRoot(rootInput);
    const displayName = option(args, "display-name") || path.basename(root) || suggestedWorkspaceId(root);
    const configuration = await resolveNamedAccessConfiguration(
      option(args, "access-profile") || "Reader",
      new AccessProfileStore(resolveAccessProfileFile()),
    );
    const policy = accessConfigurationToWorkspacePolicy(configuration);
    answers = { root, displayName, profile: policy.profile as WorkspaceProfile };
    interactivePolicy = { tools: policy.tools, commands: policy.commands };
  } else if (prompt) {
    answers = await testPromptAnswers(prompt);
  } else {
    const injectedPrompts = interactiveDependencies.prompts;
    if (!injectedPrompts) intro("Add Workspace");
    const prompts = injectedPrompts || createAccessConfigurationPrompts({ cancelMessage: "Workspace setup cancelled" });
    const profileStore = interactiveDependencies.profileStore || new AccessProfileStore(resolveAccessProfileFile());
    const candidate = await interactiveWorkspaceCandidate({
      cwd: process.cwd(),
      pathPrompt: interactiveDependencies.pathPrompt || workspacePath,
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
  if (!prompt && !scripted && !interactiveDependencies.prompts) outro(`Workspace added: ${addedWorkspace.displayName}`);
  return { added: true, workspace: next.workspaces.find((entry) => entry.id === addedWorkspace?.id) };
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
