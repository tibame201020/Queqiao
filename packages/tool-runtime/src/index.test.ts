import { z } from "zod";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ExtensionHost, ToolRuntime, resolveExtensionComposition, type QueqiaoExtension, type ToolDefinition } from "./index.js";
import type { ExtensionManifestConfig, InstalledExtensionConfig } from "@queqiao/config";

type Context = { allowed: boolean; trace: string[] };

function tool(name: string, value = name): ToolDefinition<Context> {
  return {
    name,
    title: name,
    description: "test tool",
    inputSchema: z.object({ value: z.string().optional() }),
    requiredCapabilities: ["workspace:read"],
    risk: "read",
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    execute: async () => value,
  };
}

function manifest(id: string, contributions: ExtensionManifestConfig["contributions"] = [], ordering: ExtensionManifestConfig["ordering"] = { requires: [], before: [], after: [] }): ExtensionManifestConfig {
  return { id, version: "1.0.0", displayName: id, host: { kind: "gateway" }, ordering, contributions };
}

function module(id: string, activate: QueqiaoExtension<Context>["activate"]): QueqiaoExtension<Context> {
  return { manifest: { id, version: "1.0.0", displayName: id }, activate };
}

describe("extension composition resolver", () => {
  it("resolves a deterministic DAG independent of input order", () => {
    const alpha = manifest("dev.queqiao.alpha", [], { requires: [], before: [], after: [] });
    const beta = manifest("dev.queqiao.beta", [], { requires: [alpha.id], before: [], after: [] });
    const gamma = manifest("dev.queqiao.gamma", [], { requires: [], before: [beta.id], after: [alpha.id] });
    expect(resolveExtensionComposition([beta, gamma, alpha]).order).toEqual([alpha.id, gamma.id, beta.id]);
    expect(resolveExtensionComposition([alpha, beta, gamma]).order).toEqual([alpha.id, gamma.id, beta.id]);
  });

  it("fails closed on missing requirements, cycles, registration collisions and duplicate replacements", () => {
    expect(() => resolveExtensionComposition([manifest("dev.queqiao.a", [], { requires: ["dev.queqiao.missing"], before: [], after: [] })])).toThrow(/Missing required/);
    const a = manifest("dev.queqiao.a", [], { requires: ["dev.queqiao.b"], before: [], after: [] });
    const b = manifest("dev.queqiao.b", [], { requires: [a.id], before: [], after: [] });
    expect(() => resolveExtensionComposition([a, b])).toThrow(/cycle/);
    const register = { operation: "register" as const, tool: "extra", visibility: "public" as const, title: "Extra", description: "extra", inputSchema: { type: "object" }, requiredCapabilities: [], risk: "read" as const, annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } };
    expect(() => resolveExtensionComposition([manifest("dev.queqiao.a", [register])], ["extra"])).toThrow(/collision/);
    const replace = { operation: "replace" as const, tool: "core", preservesContract: true as const, requiredCapabilities: [] };
    expect(() => resolveExtensionComposition([manifest("dev.queqiao.a", [replace]), manifest("dev.queqiao.b", [replace])], ["core"])).toThrow(/Multiple replacements/);
  });
});

describe("ToolRuntime composition", () => {
  it("applies declared before/wrap/after extensions and one explicit replacement in DAG order", async () => {
    const extenderId = "dev.queqiao.extender";
    const replacerId = "dev.queqiao.replacer";
    const extender = manifest(extenderId, [
      { operation: "extend", tool: "core", stage: "before", requiredCapabilities: [] },
      { operation: "extend", tool: "core", stage: "wrap", requiredCapabilities: [] },
      { operation: "extend", tool: "core", stage: "after", requiredCapabilities: [] },
    ]);
    const replacer = manifest(replacerId, [{ operation: "replace", tool: "core", preservesContract: true, requiredCapabilities: ["workspace:read"] }], { requires: [extenderId], before: [], after: [] });
    const runtime = new ToolRuntime<Context>([tool("core", "base")]);
    runtime.compose([
      { config: replacer, module: module(replacerId, (api) => api.replaceTool("core", tool("core", "replacement"))) },
      { config: extender, module: module(extenderId, (api) => {
        api.extendTool("core", "before", (call) => { call.context.trace.push("before"); });
        api.extendTool("core", "wrap", async (call, next) => { call.context.trace.push("wrap-in"); const result = await next(); call.context.trace.push("wrap-out"); return result; });
        api.extendTool("core", "after", (call) => { call.context.trace.push("after"); return `${call.result}:after`; });
      }) },
    ]);
    const context = { allowed: true, trace: [] as string[] };
    await expect(runtime.execute("core", {}, context)).resolves.toBe("replacement:after");
    expect(context.trace).toEqual(["before", "wrap-in", "wrap-out", "after"]);
  });

  it("rolls back atomically when activation is undeclared or module identity mismatches", () => {
    const config = manifest("dev.queqiao.bad", []);
    const runtime = new ToolRuntime<Context>([tool("core")]);
    expect(() => runtime.compose([{ config, module: module(config.id, (api) => api.registerTool(tool("undeclared"))) }])).toThrow(/Undeclared/);
    expect(runtime.definitions().map((entry) => entry.name)).toEqual(["core"]);
    const runtime2 = new ToolRuntime<Context>([tool("core")]);
    expect(() => runtime2.compose([{ config, module: module("dev.queqiao.other", () => undefined) }])).toThrow(/mismatch/);
    expect(runtime2.definitions().map((entry) => entry.name)).toEqual(["core"]);
  });
});

describe("ExtensionHost", () => {
  it("loads an explicitly configured local module and applies Workspace scope without mutating deployment public declarations", async () => {
    const directory = await mkdtemp(join(tmpdir(), "queqiao-extension-host-"));
    try {
      const modulePath = join(directory, "scoped.mjs");
      await writeFile(modulePath, `
        export default {
          manifest: { id: "dev.queqiao.scoped", version: "1.0.0", displayName: "Scoped" },
          activate(api) {
            api.extendTool("core", "after", (call) => String(call.result) + ":scoped");
          }
        };
      `, "utf8");
      const extension: InstalledExtensionConfig = {
        enabled: true,
        trusted: true,
        source: { kind: "local-module", module: modulePath },
        activation: { kind: "workspaces", workspaceIds: ["alpha"] },
        manifest: {
          id: "dev.queqiao.scoped", version: "1.0.0", displayName: "Scoped",
          host: { kind: "worker", environmentId: "windows" },
          ordering: { requires: [], before: [], after: [] },
          contributions: [{ operation: "extend", tool: "core", stage: "after", requiredCapabilities: ["workspace:read"] }],
        },
      };
      const host = new ExtensionHost<Context>([extension], { kind: "worker", environmentId: "windows" }, directory, undefined, ["core"]);
      await host.load();
      expect(host.loadedIds()).toEqual(["dev.queqiao.scoped"]);
      expect(host.publicManifests()).toEqual([]);
      const alpha = host.runtimeForWorkspace("alpha", [tool("core")]);
      const beta = host.runtimeForWorkspace("beta", [tool("core")]);
      expect(alpha.definitions().map((entry) => entry.name)).toEqual(["core"]);
      expect(beta.definitions().map((entry) => entry.name)).toEqual(["core"]);
      await expect(alpha.execute("core", {}, { allowed: true, trace: [] })).resolves.toBe("core:scoped");
      await expect(beta.execute("core", {}, { allowed: true, trace: [] })).resolves.toBe("core");
      expect(host.publicManifests()).toEqual([]);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it("filters by declared host and leaves load state empty after an import failure", async () => {
    const gatewayExtension: InstalledExtensionConfig = {
      enabled: true, trusted: true, source: { kind: "local-module", module: "missing-module" }, activation: { kind: "global" },
      manifest: { id: "dev.queqiao.gateway", version: "1.0.0", displayName: "Gateway", host: { kind: "gateway" }, ordering: { requires: [], before: [], after: [] }, contributions: [] },
    };

    const allWorkers: InstalledExtensionConfig = {
      enabled: true, trusted: true, source: { kind: "local-module", module: "all-worker" }, activation: { kind: "global" },
      manifest: { id: "dev.queqiao.all-worker", version: "1.0.0", displayName: "All Worker", host: { kind: "worker" }, ordering: { requires: [], before: [], after: [] }, contributions: [] },
    };
    const linuxHost = new ExtensionHost<Context>([allWorkers], { kind: "worker", environmentId: "linux" }, process.cwd(), async () => ({ default: module("dev.queqiao.all-worker", () => undefined) }));
    await linuxHost.load();
    expect(linuxHost.loadedIds()).toEqual(["dev.queqiao.all-worker"]);
    const workerHost = new ExtensionHost<Context>([gatewayExtension], { kind: "worker", environmentId: "windows" }, process.cwd(), async () => { throw new Error("must not import"); });
    await workerHost.load();
    expect(workerHost.loadedIds()).toEqual([]);

    const gatewayHost = new ExtensionHost<Context>([gatewayExtension], { kind: "gateway" }, process.cwd(), async () => { throw new Error("import failed"); });
    await expect(gatewayHost.load()).rejects.toThrow(/import failed/);
    expect(gatewayHost.loadedIds()).toEqual([]);
  });
});
