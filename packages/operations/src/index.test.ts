import { describe, expect, it } from "vitest";
import { z } from "zod";
import type { InstalledExtensionConfig } from "@queqiao/config";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import {
  buildDeploymentManifest,
  buildOperationsDiagnostics,
  canonicalJson,
  deploymentManifestFingerprint,
  explainTool,
  publicOperationsProjection,
} from "./index.js";

function register(tool: string, description = "Extension tool") {
  return {
    operation: "register" as const,
    tool,
    visibility: "public" as const,
    title: tool,
    description,
    inputSchema: { type: "object", properties: { workspaceId: { type: "string" } }, required: ["workspaceId"] },
    requiredCapabilities: ["workspace:read" as const],
    risk: "read" as const,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  };
}

function installed(id: string, contributions: InstalledExtensionConfig["manifest"]["contributions"], options: { version?: string; activation?: InstalledExtensionConfig["activation"] } = {}): InstalledExtensionConfig {
  return {
    trusted: true,
    source: { kind: "local-module", module: `C:/private/extensions/${id}.mjs` },
    activation: options.activation ?? { kind: "global" },
    manifest: {
      id,
      version: options.version ?? "1.0.0",
      displayName: id,
      host: { kind: "worker", environmentId: "windows" },
      ordering: { requires: [], before: [], after: [] },
      contributions,
    },
  };
}

function diagnostics(extensions: readonly InstalledExtensionConfig[] = []) {
  return buildOperationsDiagnostics({
    coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION,
    workerProtocolVersion: "2.0",
    supportedMcpProtocolVersions: ["2026-07-28", "2025-11-25"],
    coreTools: CORE_PUBLIC_TOOLS,
    extensions,
  });
}

describe("deployment manifest fingerprint", () => {
  it("preserves Revision 4/5 fingerprint history and advances to Revision 6 for targetable workspace_info", () => {
    const revision4Fingerprint = "sha256:bc96f482e2c5b395d466565706712ea76d067bdf14b4be801d5395ad4673c1fe";
    const revision5CoreTools = CORE_PUBLIC_TOOLS.map((tool) => tool.name === "workspace_info" ? {
      ...tool,
      description: "Show the workspace and native environment currently exposed through Queqiao.",
      inputSchema: z.object({}),
    } : tool);
    const revision5Manifest = buildDeploymentManifest({ coreManifestRevision: 5, coreTools: revision5CoreTools, extensions: [] });
    const revision5Fingerprint = deploymentManifestFingerprint(revision5Manifest);
    expect(revision5Fingerprint).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(revision5Fingerprint).not.toBe(revision4Fingerprint);
    const revision5WorkspaceSchema = revision5Manifest.tools.find((entry) => entry.name === "workspace_info")!.inputSchema as { properties?: Record<string, unknown> };
    expect(revision5WorkspaceSchema.properties ?? {}).not.toHaveProperty("workspaceId");

    const state = diagnostics();
    expect(QUEQIAO_CORE_MANIFEST_REVISION).toBe(7);
    expect(state.deploymentManifestFingerprint).not.toBe(revision4Fingerprint);
    expect(state.deploymentManifestFingerprint).not.toBe(revision5Fingerprint);
    const manifest = buildDeploymentManifest({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, coreTools: CORE_PUBLIC_TOOLS, extensions: [] });
    const workspaceInfo = manifest.tools.find((entry) => entry.name === "workspace_info")!;
    const workspaceSchema = workspaceInfo.inputSchema as { properties?: Record<string, unknown>; required?: string[] };
    expect(workspaceSchema.properties).toHaveProperty("workspaceId");
    expect(workspaceSchema.required ?? []).not.toContain("workspaceId");
    for (const name of ["run", "shell"]) {
      const tool = manifest.tools.find((entry) => entry.name === name)!;
      const schema = tool.inputSchema as { properties?: Record<string, { default?: unknown; enum?: unknown[] }> };
      expect(schema.properties?.["mode"]).toMatchObject({ default: "sync", enum: ["sync", "async"] });
    }
  });

  it("is deterministic across configuration order, process reconstruction, extension version and Workspace scope when public contracts are unchanged", () => {
    const alpha = installed("dev.queqiao.alpha", [register("alpha_read")], { activation: { kind: "workspaces", workspaceIds: ["beta", "alpha"] } });
    const beta = installed("dev.queqiao.beta", [register("beta_read")]);
    const first = diagnostics([beta, alpha]).deploymentManifestFingerprint;
    const second = diagnostics([installed("dev.queqiao.alpha", [register("alpha_read")], { version: "1.0.1", activation: { kind: "global" } }), beta]).deploymentManifestFingerprint;
    expect(first).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(second).toBe(first);
    expect(diagnostics([beta, alpha]).deploymentManifestFingerprint).toBe(first);
  });

  it("changes for public tool/schema/metadata changes but not implementation-only replace/extend composition", () => {
    const base = diagnostics().deploymentManifestFingerprint;
    const added = diagnostics([installed("dev.queqiao.reader", [register("extension_read")])]).deploymentManifestFingerprint;
    const changedDescription = diagnostics([installed("dev.queqiao.reader", [register("extension_read", "Changed public description")])]).deploymentManifestFingerprint;
    expect(added).not.toBe(base);
    expect(changedDescription).not.toBe(added);

    const replaced = installed("dev.queqiao.replace", [{ operation: "replace", tool: "read_file", preservesContract: true, requiredCapabilities: ["workspace:read"] }]);
    const extended = installed("dev.queqiao.extend", [{ operation: "extend", tool: "read_file", stage: "after", requiredCapabilities: ["workspace:read"] }]);
    expect(diagnostics([replaced, extended]).deploymentManifestFingerprint).toBe(base);
  });

  it("treats attached public extensions as active and canonicalizes schema object key order", () => {
    const attached = installed("dev.queqiao.reader", [register("extension_read")]);
    expect(diagnostics([attached]).deploymentManifestFingerprint).not.toBe(diagnostics().deploymentManifestFingerprint);
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 }, $schema: "ignored" })).toBe('{"a":{"c":3,"d":2},"b":1}');
  });

  it("fingerprints the actual shared Core contract source", () => {
    const manifest = buildDeploymentManifest({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, coreTools: CORE_PUBLIC_TOOLS, extensions: [] });
    expect(manifest.tools.map((tool) => tool.name).sort()).toEqual(CORE_PUBLIC_TOOLS.map((tool) => tool.name).sort());
    expect(deploymentManifestFingerprint(manifest)).toBe(diagnostics().deploymentManifestFingerprint);
  });
});

describe("composition diagnostics", () => {
  it("reports structured conflicts with affected tool/extensions and no misleading fingerprint", () => {
    const conflict = diagnostics([installed("dev.queqiao.collision", [register("read_file")])]);
    expect(conflict.ok).toBe(false);
    expect(conflict.deploymentManifestFingerprint).toBeNull();
    expect(conflict.compositionFailure).toMatchObject({ code: "registration_collision", tool: "read_file", extensionIds: ["dev.queqiao.collision"] });
  });

  it("describes replacement/extender runtime composition truth and redacts local module paths", () => {
    const replacement = installed("dev.queqiao.replace", [{ operation: "replace", tool: "read_file", preservesContract: true, requiredCapabilities: ["workspace:read"] }]);
    const extender = installed("dev.queqiao.extend", [{ operation: "extend", tool: "read_file", stage: "after", requiredCapabilities: ["workspace:read"] }]);
    const state = diagnostics([replacement, extender]);
    expect(explainTool(state, "read_file")).toMatchObject({ name: "read_file", registeredBy: "core", replacementBy: "dev.queqiao.replace", extenders: [{ extensionId: "dev.queqiao.extend", stage: "after" }] });
    const serialized = JSON.stringify(state);
    expect(serialized).not.toContain("C:/private/extensions");
    expect(serialized).not.toContain("local-module");
  });

  it("provides separate admin and narrow public projections from the same semantic state", () => {
    const extension = installed("dev.queqiao.reader", [register("extension_read")], { activation: { kind: "workspaces", workspaceIds: ["alpha"] } });
    const state = diagnostics([extension]);
    const publicState = publicOperationsProjection(state);
    expect(state.extensions[0]).toMatchObject({ id: "dev.queqiao.reader", activation: { kind: "workspaces", workspaceIds: ["alpha"] }, loadState: "not_observed" });
    expect(publicState).toEqual({ coreManifestRevision: 7, deploymentManifestFingerprint: state.deploymentManifestFingerprint, publicToolCount: 12, workerProtocolVersion: "2.0", supportedMcpProtocolVersions: ["2026-07-28", "2025-11-25"] });
    expect(JSON.stringify(publicState)).not.toContain("dev.queqiao.reader");
    expect(JSON.stringify(publicState)).not.toContain("alpha");
  });
});
