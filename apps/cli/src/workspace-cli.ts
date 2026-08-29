import path from "node:path";
import { group, intro, isCancel, outro, select, text, cancel } from "@clack/prompts";
import { workspacePath } from "./workspace-path-prompt.js";
import { runtimeConfigSchema, workspaceConfigSchema, type RuntimeConfig, type WorkspaceConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";
import { secureRuntimeFile } from "./secure-runtime-paths.js";

export type WorkspacePrompt = (message: string) => Promise<string>;
export type WorkspaceProfile = "read-only" | "editor" | "coding";
export type WorkspaceAnswers = { root: string; id: string; displayName: string; profile: WorkspaceProfile };

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

export function parseWorkspaceProfile(value: string | undefined): WorkspaceProfile {
  const normalized = (value || "read-only").trim().toLowerCase();
  if (normalized === "1" || normalized === "read-only" || normalized === "readonly") return "read-only";
  if (normalized === "2" || normalized === "editor") return "editor";
  if (normalized === "3" || normalized === "coding") return "coding";
  throw new Error("Profile must be 1/read-only, 2/editor, or 3/coding");
}

export function workspaceConfigFromAnswers(answers: WorkspaceAnswers): WorkspaceConfig {
  return workspaceConfigSchema.parse({
    id: answers.id,
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
      id: async ({ results }) => {
        const root = String(results.root || cwd);
        const suggested = suggestedWorkspaceId(root);
        return assertNotCancelled(await text({
          message: "Workspace id",
          placeholder: suggested,
          defaultValue: suggested,
          validate: (value) => /^[a-z][a-z0-9_-]*$/.test(value || suggested) ? undefined : "Use lowercase letters, numbers, _ or -; start with a letter",
        }));
      },
      displayName: async ({ results }) => {
        const id = String(results.id || suggestedWorkspaceId(String(results.root || cwd)));
        return assertNotCancelled(await text({
          message: "Display name",
          placeholder: id,
          defaultValue: id,
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
      id: String(answers.id),
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
  const suggestedId = suggestedWorkspaceId(root);
  const id = (await prompt(`Workspace id [${suggestedId}]: `)).trim() || suggestedId;
  const displayName = (await prompt(`Display name [${id}]: `)).trim() || id;
  const profile = parseWorkspaceProfile((await prompt("Profile [1=read-only, 2=editor, 3=coding] (1): ")).trim());
  return { root, id, displayName, profile };
}

export async function addWorkspace(configFile: string, args: string[], prompt?: WorkspacePrompt): Promise<unknown> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  const current = await store.read();
  if (!current.worker) throw new Error("Worker setup is required before adding a Workspace");

  const scripted = option(args, "root") || option(args, "id") || option(args, "name") || option(args, "profile");
  let answers: WorkspaceAnswers;

  if (scripted) {
    const rootInput = option(args, "root");
    if (!rootInput) throw new Error("--root is required when using non-interactive workspace options");
    const root = await resolveWorkspaceAuthorityRoot(rootInput);
    const id = option(args, "id") || suggestedWorkspaceId(root);
    const displayName = option(args, "name") || id;
    answers = { root, id, displayName, profile: parseWorkspaceProfile(option(args, "profile")) };
  } else if (prompt) {
    answers = await testPromptAnswers(prompt);
  } else {
    const raw = await interactiveWorkspaceAnswers(process.cwd());
    answers = { ...raw, root: await resolveWorkspaceAuthorityRoot(raw.root) };
  }

  const workspace = workspaceConfigFromAnswers(answers);
  const next = await store.update((config) => {
    if (!config.worker) throw new Error("Worker setup is required before adding a Workspace");
    if (config.workspaces.some((entry) => entry.id === workspace.id)) throw new Error(`Workspace already exists: ${workspace.id}`);
    return runtimeConfigSchema.parse({
      ...config,
      workspaces: [...config.workspaces, workspace],
    });
  });
  await secureRuntimeFile(configFile);
  if (!prompt && !scripted) outro(`Workspace added: ${workspace.id}`);
  return { added: true, workspace: next.workspaces.find((entry) => entry.id === workspace.id) };
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

export const workspaceCliInternals = { suggestedWorkspaceId, parseProfile: parseWorkspaceProfile, workspaceConfigFromAnswers };
