import { stat } from "node:fs/promises";
import path from "node:path";
import { readRuntimeConfig, type InstalledExtensionConfig } from "@queqiao/config";
import { ExtensionHost, type ExtensionModuleImporter } from "@queqiao/tool-runtime";
import { createWorkerToolRuntimeForWorkspace, type WorkerToolContext } from "./core-tools.js";

export type ExtensionHostLease = {
  host: ExtensionHost<WorkerToolContext>;
  generation: number;
  release(): Promise<void>;
};

export type ExtensionReloadResult =
  | { changed: false }
  | { changed: true; generation: number }
  | { changed: false; rejected: Error };

type Generation = {
  id: number;
  host: ExtensionHost<WorkerToolContext>;
  refs: number;
  retired: boolean;
  replacement: ExtensionHost<WorkerToolContext> | undefined;
  disposePromise?: Promise<void>;
};

function extensionsFingerprint(extensions: readonly InstalledExtensionConfig[]): string {
  return JSON.stringify(extensions);
}

export class ReloadableExtensionHost {
  private observedRevision = "";
  private activeFingerprint = "";
  private currentGeneration: Generation | undefined;
  private refreshPromise: Promise<ExtensionReloadResult> | undefined;
  private nextGeneration = 1;

  constructor(
    private readonly configFile: string,
    private readonly environmentId: string,
    private readonly importer: ExtensionModuleImporter,
    private readonly coreToolNames: readonly string[],
  ) {}

  async initialize(): Promise<void> {
    const runtime = await readRuntimeConfig(this.configFile);
    if (!runtime.worker) throw new Error("worker configuration is required");
    if (runtime.worker.environmentId !== this.environmentId) throw new Error("Worker environment changed while creating ExtensionHost");
    const host = await this.build(runtime.extensions, runtime.workspaces.map((workspace) => workspace.id));
    this.currentGeneration = { id: this.nextGeneration++, host, refs: 0, retired: false, replacement: undefined };
    this.activeFingerprint = extensionsFingerprint(runtime.extensions);
    this.observedRevision = await this.fileRevision();
  }

  async refresh(): Promise<ExtensionReloadResult> {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.doRefresh().finally(() => { this.refreshPromise = undefined; });
    return this.refreshPromise;
  }

  acquire(): ExtensionHostLease {
    const generation = this.currentGeneration;
    if (!generation) throw new Error("ReloadableExtensionHost is not initialized");
    generation.refs += 1;
    let released = false;
    return {
      host: generation.host,
      generation: generation.id,
      release: async () => {
        if (released) return;
        released = true;
        generation.refs -= 1;
        await this.disposeIfRetired(generation);
      },
    };
  }

  async dispose(): Promise<void> {
    const generation = this.currentGeneration;
    this.currentGeneration = undefined;
    if (!generation) return;
    generation.retired = true;
    generation.replacement = undefined;
    await this.disposeIfRetired(generation);
  }

  private async doRefresh(): Promise<ExtensionReloadResult> {
    if (!this.currentGeneration) throw new Error("ReloadableExtensionHost is not initialized");
    const revision = await this.fileRevision();
    if (revision === this.observedRevision) return { changed: false };

    let runtime;
    try {
      runtime = await readRuntimeConfig(this.configFile);
      if (!runtime.worker) throw new Error("worker configuration is required");
      if (runtime.worker.environmentId !== this.environmentId) throw new Error(`Worker environment changed from ${this.environmentId} to ${runtime.worker.environmentId}`);
    } catch (error) {
      this.observedRevision = revision;
      return { changed: false, rejected: error instanceof Error ? error : new Error(String(error)) };
    }

    const fingerprint = extensionsFingerprint(runtime.extensions);
    if (fingerprint === this.activeFingerprint) {
      this.observedRevision = revision;
      return { changed: false };
    }

    let nextHost: ExtensionHost<WorkerToolContext>;
    try {
      nextHost = await this.build(runtime.extensions, runtime.workspaces.map((workspace) => workspace.id));
    } catch (error) {
      this.observedRevision = revision;
      return { changed: false, rejected: error instanceof Error ? error : new Error(String(error)) };
    }

    const previous = this.currentGeneration;
    const next: Generation = { id: this.nextGeneration++, host: nextHost, refs: 0, retired: false, replacement: undefined };
    this.currentGeneration = next;
    this.activeFingerprint = fingerprint;
    this.observedRevision = revision;
    previous.retired = true;
    previous.replacement = nextHost;
    void this.disposeIfRetired(previous);
    return { changed: true, generation: next.id };
  }

  private async build(extensions: readonly InstalledExtensionConfig[], workspaceIds: readonly string[]): Promise<ExtensionHost<WorkerToolContext>> {
    const host = new ExtensionHost<WorkerToolContext>(
      extensions,
      { kind: "worker", environmentId: this.environmentId },
      path.dirname(this.configFile),
      this.importer,
      this.coreToolNames,
    );
    await host.load();
    for (const workspaceId of workspaceIds) createWorkerToolRuntimeForWorkspace(host, workspaceId);
    return host;
  }

  private async fileRevision(): Promise<string> {
    const info = await stat(this.configFile, { bigint: true });
    return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}`;
  }

  private async disposeIfRetired(generation: Generation): Promise<void> {
    if (!generation.retired || generation.refs !== 0) return;
    generation.disposePromise ??= generation.host.disposeReplacedBy(generation.replacement);
    await generation.disposePromise;
  }
}
