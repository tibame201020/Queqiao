import path from "node:path";
import { group, intro, isCancel, outro, select, text, cancel } from "@clack/prompts";
import { workspacePath } from "./workspace-path-prompt.js";
import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig, type WorkspaceConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { resolveWorkspaceAuthorityRoot, workspaceRootsEqual } from "./workspace-authority.js";
import { secureRuntimeFile } from "./secure-runtime-paths.js";

export type WorkspacePrompt = (message: string) => Promise<string>;
export type WorkspaceProfile = "read-only" | "editor" | "coding";
export type WorkspaceAnswers = { root: string; displayName: string; profile: WorkspaceProfile };

function option(args: string[], name: string): string | undefined {
  const index = args.indexOf(`--${name}`);
  return index >= 0 ? args[index + 1] : undefined;
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

async function interactiveWorkspaceAnswers(cwd: string): Promise<WorkspaceAnswers> {
  intro("Add workspace");
  try {
    const answers = await group({
      root: async () => assertNotCancelled(await workspacePath(cwd)),
      displayName: async ({ results }) => {
        const root = String(results.root || cwd);
        const suggested = path.basename(root) || suggestedWorkspaceId(root);
        return assertNotCancelled(await text({
          message: "Display name",
          placeholder: suggested,
          defaultValue: suggested,
        }));
      },
      profile: async () => assertNotCancelled(await select({
        message: "Access profile",
        initialValue: "read-only" as const,
        options: [
          { value: "read-only" as const, label: "Read only", hint: "files can be inspected but not changed" },
          { value: "editor" as const, label: "Editor", hint: "file edits without command execution" },
          { value: "coding" as const, label: "Coding", hint: "coding tools; commands still require allowlists" },
        ],
      })),
    }, {
      onCancel: () => cancel("Workspace setup cancelled"),
    });
    return {
      root: String(answers.root),
      displayName: String(answers.displayName),
      profile: parseWorkspaceProfile(String(answers.profile)),
    };
  } catch (error) {
    if (error instanceof Error && error.message === "Workspace setup cancelled") throw error;
    throw error;
  }
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
  const scripted = option(args, "root") || option(args, "name") || option(args, "profile");
  let answers: WorkspaceAnswers;

  if (scripted) {
    const rootInput = option(args, "root");
    if (!rootInput) throw new Error("--root is required when using non-interactive workspace options");
    const root = await resolveWorkspaceAuthorityRoot(rootInput);
    const displayName = option(args, "name") || path.basename(root) || suggestedWorkspaceId(root);
    answers = { root, displayName, profile: parseWorkspaceProfile(option(args, "profile")) };
  } else if (prompt) {
    answers = await testPromptAnswers(prompt);
  } else {
    const raw = await interactiveWorkspaceAnswers(process.cwd());
    answers = { ...raw, root: await resolveWorkspaceAuthorityRoot(raw.root) };
  }

  let addedWorkspace: WorkspaceConfig | undefined;
  const next = await store.update((config) => {
    if (!config.worker) throw new Error("Worker setup is required before adding a Workspace");
    if (config.workspaces.some((entry) => workspaceRootsEqual(entry.root, answers.root))) {
      throw new Error(`Workspace path is already authorized: ${answers.root}`);
    }
    const id = uniqueWorkspaceId(answers.root, config.workspaces.map((entry) => entry.id));
    addedWorkspace = workspaceConfigFromAnswers(answers, id);
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

export const workspaceCliInternals = { suggestedWorkspaceId, uniqueWorkspaceId, parseProfile: parseWorkspaceProfile, workspaceConfigFromAnswers };
