import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { serializeRuntimeConfig, type InstalledExtensionConfig } from "@queqiao/config";
import type { QueqiaoExtension } from "@queqiao/tool-runtime";
import type { WorkerToolContext } from "./core-tools.js";
import { ReloadableExtensionHost } from "./reloadable-extension-host.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

function installed(id: string, module: string): InstalledExtensionConfig {
  return {
    trusted: true,
    source: { kind: "local-module", module },
    activation: { kind: "global" },
    manifest: {
      id,
      version: "1.0.0",
      displayName: id,
      host: { kind: "worker", environmentId: "windows" },
      ordering: { requires: [], before: [], after: [] },
      contributions: [],
    },
  };
}

function runtimeConfig(root: string, extensions: readonly InstalledExtensionConfig[]) {
  return {
    version: 1 as const,
    worker: { environmentId: "windows", listen: { host: "127.0.0.1" as const, port: 7576 }, tokenFile: path.join(root, "worker.secret"), defaultWorkspaceId: "alpha" },
    workspaces: [{ id: "alpha", displayName: "Alpha", root, profile: "coding" as const }],
    extensions,
  };
}

async function atomicConfig(file: string, value: unknown) {
  const temporary = `${file}.${Math.random().toString(16).slice(2)}.tmp`;
  await writeFile(temporary, serializeRuntimeConfig(value), "utf8");
  await rename(temporary, file);
}

function extension(id: string, onDispose: () => void): QueqiaoExtension<WorkerToolContext> {
  return { manifest: { id, version: "1.0.0", displayName: id }, activate() {}, dispose: async () => { onDispose(); } };
}

describe("ReloadableExtensionHost", () => {
  it("atomically swaps generations, keeps last-known-good, and disposes a retired host only after its request lease ends", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-reload-")); roots.push(root);
    const file = path.join(root, "config.yaml");
    const a = installed("dev.test.a", "./a.mjs");
    const b = installed("dev.test.b", "./b.mjs");
    const broken = installed("dev.test.broken", "./broken.mjs");
    let disposedA = 0;
    let disposedB = 0;
    const modules = new Map<string, QueqiaoExtension<WorkerToolContext>>([
      ["a.mjs", extension("dev.test.a", () => { disposedA += 1; })],
      ["b.mjs", extension("dev.test.b", () => { disposedB += 1; })],
      ["broken.mjs", {
        manifest: { id: "dev.test.broken", version: "1.0.0", displayName: "broken" },
        activate(api) {
          api.registerTool({
            name: "undeclared_tool",
            title: "Undeclared",
            description: "This contribution is intentionally absent from the manifest.",
            inputSchema: z.object({}),
            requiredCapabilities: [],
            risk: "read",
            annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
            async execute() { return {}; },
          });
        },
      }],
    ]);
    await atomicConfig(file, runtimeConfig(root, [a]));
    const host = new ReloadableExtensionHost(file, "windows", async (specifier) => {
      const name = [...modules.keys()].find((candidate) => specifier.endsWith(candidate));
      if (!name) throw new Error(`module unavailable: ${specifier}`);
      return { default: modules.get(name) };
    }, []);
    await host.initialize();

    const oldLease = host.acquire();
    expect(oldLease.host.loadedIds()).toEqual(["dev.test.a"]);
    await atomicConfig(file, runtimeConfig(root, [b]));
    const swapped = await host.refresh();
    expect(swapped).toMatchObject({ changed: true });
    expect(disposedA).toBe(0);
    const newLease = host.acquire();
    expect(newLease.host.loadedIds()).toEqual(["dev.test.b"]);

    await oldLease.release();
    expect(disposedA).toBe(1);

    await atomicConfig(file, runtimeConfig(root, [broken]));
    const rejected = await host.refresh();
    expect(rejected).toMatchObject({ changed: false });
    expect("rejected" in rejected).toBe(true);
    const lastGood = host.acquire();
    expect(lastGood.host.loadedIds()).toEqual(["dev.test.b"]);
    await lastGood.release();

    await newLease.release();
    expect(disposedB).toBe(0);
    await host.dispose();
    expect(disposedB).toBe(1);
  });
});
