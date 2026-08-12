import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { parse } from "yaml";
import { SafeWorkspace } from "@queqiao/workspace";
import type { PublicToolName } from "@queqiao/protocol";

const existingToolSchema = z.enum(["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "run", "list_directory", "search_text"]);

export const workerWorkspaceConfigSchema = z.object({
  id: z.string().min(1).max(64).regex(/^[a-z][a-z0-9_-]*$/),
  displayName: z.string().min(1).max(128),
  root: z.string().min(1),
  profile: z.enum(["read-only", "editor", "coding"]).default("read-only"),
  tools: z.object({ allow: z.array(existingToolSchema).default([]), deny: z.array(existingToolSchema).default([]) }).default({ allow: [], deny: [] }),
  commands: z.object({ allow: z.array(z.string().min(1).max(128)).default([]) }).default({ allow: [] }),
});
export type WorkerWorkspaceConfig = z.infer<typeof workerWorkspaceConfigSchema>;
const workspaceFileSchema = z.array(workerWorkspaceConfigSchema).min(1);

type WorkspaceEntry = { config: WorkerWorkspaceConfig; reader: SafeWorkspace };

export class WorkspaceCatalog {
  private entries = new Map<string, WorkspaceEntry>();
  private loadedMtimeMs = -1;
  private loading: Promise<void> | undefined;

  constructor(
    private readonly defaultWorkspaceId: string,
    private readonly source: { file: string } | { workspaces: readonly WorkerWorkspaceConfig[] },
  ) {}

  async initialize(): Promise<void> { await this.reload(true); }

  async refresh(): Promise<void> {
    if ("file" in this.source) await this.reload(false);
  }

  private async reload(force: boolean): Promise<void> {
    if (this.loading) return this.loading;
    this.loading = this.doReload(force).finally(() => { this.loading = undefined; });
    return this.loading;
  }

  private async doReload(force: boolean): Promise<void> {
    let raw: unknown;
    let mtimeMs = this.loadedMtimeMs;
    if ("file" in this.source) {
      const info = await stat(this.source.file);
      if (!force && info.mtimeMs === this.loadedMtimeMs) return;
      mtimeMs = info.mtimeMs;
      raw = (parse(await readFile(this.source.file, "utf8")) as { workspaces?: unknown }).workspaces;
    } else {
      if (!force) return;
      raw = this.source.workspaces;
    }
    const configs = workspaceFileSchema.parse(raw);
    if (new Set(configs.map((entry) => entry.id)).size !== configs.length) throw new Error("Workspace IDs must be unique");
    const next = new Map<string, WorkspaceEntry>();
    for (const config of configs) {
      const reader = new SafeWorkspace(path.resolve(config.root));
      await reader.initialize();
      next.set(config.id, { config, reader });
    }
    if (!next.has(this.defaultWorkspaceId)) throw new Error(`Default workspace not found: ${this.defaultWorkspaceId}`);
    this.entries = next;
    this.loadedMtimeMs = mtimeMs;
  }

  list(): WorkspaceEntry[] { return [...this.entries.values()]; }
  get(id: string): WorkspaceEntry | undefined { return this.entries.get(id); }
  size(): number { return this.entries.size; }
}

export function workspaceAllowsTool(config: WorkerWorkspaceConfig, tool: PublicToolName): boolean {
  if (["write_file", "edit_file", "apply_patch"].includes(tool) && config.profile === "read-only") return false;
  if (tool === "run" && config.profile !== "coding") return false;
  if (config.tools.deny.includes(tool as typeof config.tools.deny[number])) return false;
  return config.tools.allow.length === 0 || config.tools.allow.includes(tool as typeof config.tools.allow[number]);
}
