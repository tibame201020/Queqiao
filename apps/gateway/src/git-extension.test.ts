import express from "express";
import type { Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { GIT_EXTENSION_MANIFEST } from "@queqiao/extension-git";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { buildDeploymentManifest, canonicalJson, deploymentManifestFingerprint } from "@queqiao/operations";
import { extensionActiveForWorkspace } from "@queqiao/tool-runtime";
import type { InstalledExtensionConfig } from "@queqiao/config";
import { createMcpNodeAdapter } from "./mcp-adapter.js";
import type { WorkerRegistry } from "./worker-registry.js";

const installed: InstalledExtensionConfig = { trusted: true, source: { kind: "local-module", module: "@queqiao/extension-git" }, activation: { kind: "global" }, manifest: GIT_EXTENSION_MANIFEST };
let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => server!.close(() => resolve())); server = undefined; });

describe("Gateway public extension projection", () => {
  it("keeps Git diagnostics deterministic when Workspace-scoped", () => {
    const attached = buildDeploymentManifest({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, coreTools: CORE_PUBLIC_TOOLS, extensions: [installed] });
    const scoped = { ...installed, activation: { kind: "workspaces" as const, workspaceIds: ["coding"] } };
    const scopedManifest = buildDeploymentManifest({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, coreTools: CORE_PUBLIC_TOOLS, extensions: [scoped] });
    expect(attached.tools).toHaveLength(CORE_PUBLIC_TOOLS.length + 7);
    expect(deploymentManifestFingerprint(scopedManifest)).toBe(deploymentManifestFingerprint(attached));
    expect(extensionActiveForWorkspace(scoped, "coding")).toBe(true);
    expect(extensionActiveForWorkspace(scoped, "other")).toBe(false);
  });

  it("publishes explicit Git schemas and forwards a named call to the Worker host", async () => {
    const invoked: Array<{ tool: string; input: unknown }> = [];
    const workers = {
      async defaultRoute() { return { workspaceId: "coding" }; },
      async workspaceRoute(workspaceId: string) { return { workspaceId, environmentId: "windows", displayName: "Coding", root: "redacted", profile: "coding", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: ["git"] }, online: true as const }; },
      async requireTool() {},
      async invokeTool(tool: string, input: unknown) {
        invoked.push({ tool, input });
        return {
          value: { ok: true, repositoryPath: "repo" },
          routing: { environmentId: "windows", requestedTransport: null, selectedTransport: "http", selectionReason: "configured_order" },
        };
      },
    } as unknown as WorkerRegistry;
    const adapter = createMcpNodeAdapter(workers, ["queqiao:access"], undefined, [installed]);
    const app = express(); app.use(express.json()); app.post("/mcp", (req, res) => { void adapter.handle(req, res, req.body); });
    server = app.listen(0, "127.0.0.1"); await new Promise<void>((resolve) => server!.once("listening", resolve));
    const address = server.address(); if (!address || typeof address === "string") throw new Error("listen failed");
    const client = new Client({ name: "extension-contract", version: "1" }, { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } });
    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
    try {
      await client.connect(transport);
      const tools = (await client.listTools()).tools;
      const manifest = buildDeploymentManifest({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, coreTools: CORE_PUBLIC_TOOLS, extensions: [installed] });
      expect(manifest.tools).toHaveLength(CORE_PUBLIC_TOOLS.length + 7);
      expect(deploymentManifestFingerprint(manifest)).toMatch(/^sha256:[0-9a-f]{64}$/);
      const actual = tools.map((tool) => ({ name: tool.name, title: tool.title, description: tool.description, inputSchema: tool.inputSchema, annotations: tool.annotations })).sort((a, b) => a.name.localeCompare(b.name));
      expect(canonicalJson(actual)).toBe(canonicalJson(manifest.tools));
      for (const name of ["git_repositories", "git_status", "git_diff", "git_log", "git_branches", "git_worktree_create", "git_worktree_remove"]) {
        const tool = tools.find((entry) => entry.name === name); expect(tool, name).toBeDefined(); expect(tool?.inputSchema).toMatchObject({ type: "object" });
      }
      const call = await client.callTool({ name: "git_status", arguments: { workspaceId: "coding", repositoryPath: "repo" } });
      expect(call.isError).not.toBe(true);
      expect(invoked).toEqual([{ tool: "git_status", input: { workspaceId: "coding", repositoryPath: "repo" } }]);
    } finally { await transport.close(); await adapter.close(); }
  });
});
