import { describe, expect, it } from "vitest";
import { runtimeConfigSchema } from "./index.js";

const base = {
  version: 1 as const,
  environments: [{ environmentId: "windows", url: "http://127.0.0.1:7576", tokenFile: "worker.secret" }],
  workspaces: [{ id: "alpha", displayName: "Alpha", root: "C:/workspace", profile: "coding" as const }],
};

const manifest = {
  id: "dev.queqiao.git",
  version: "1.0.0",
  displayName: "Git",
  host: { kind: "worker" as const, environmentId: "windows" },
  ordering: { requires: [], before: [], after: [] },
  contributions: [{
    operation: "register" as const,
    tool: "git_status",
    visibility: "public" as const,
    title: "Git status",
    description: "Read repository status",
    inputSchema: { type: "object", properties: {} },
    requiredCapabilities: ["workspace:exec" as const],
    risk: "read" as const,
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }],
};

describe("extension config schema", () => {
  it("accepts an explicitly trusted local extension with Worker host and Workspace scope", () => {
    const parsed = runtimeConfigSchema.parse({ ...base, extensions: [{ enabled: true, trusted: true, source: { kind: "local-module", module: "extensions/git.mjs" }, activation: { kind: "workspaces", workspaceIds: ["alpha"] }, manifest }] });
    expect(parsed.extensions[0]?.manifest.id).toBe("dev.queqiao.git");
  });

  it("fails closed for untrusted, unknown Worker hosts, unknown Workspaces and duplicate ids", () => {
    expect(() => runtimeConfigSchema.parse({ ...base, workspaces: [base.workspaces[0], base.workspaces[0]] })).toThrow(/Workspace id must be unique/);
    expect(() => runtimeConfigSchema.parse({ ...base, extensions: [{ trusted: false, source: { kind: "local-module", module: "x.mjs" }, manifest }] })).toThrow();
    expect(() => runtimeConfigSchema.parse({ ...base, extensions: [{ trusted: true, source: { kind: "local-module", module: "x.mjs" }, manifest: { ...manifest, host: { kind: "worker" } } }] })).not.toThrow();
    expect(() => runtimeConfigSchema.parse({ ...base, extensions: [{ trusted: true, source: { kind: "local-module", module: "x.mjs" }, manifest: { ...manifest, host: { kind: "worker", environmentId: "missing" } } }] })).toThrow(/configured environment/);
    expect(() => runtimeConfigSchema.parse({ ...base, extensions: [{ trusted: true, source: { kind: "local-module", module: "x.mjs" }, activation: { kind: "workspaces", workspaceIds: ["missing"] }, manifest }] })).toThrow(/unknown Workspace/);
    expect(() => runtimeConfigSchema.parse({ ...base, extensions: [0, 1].map(() => ({ trusted: true, source: { kind: "local-module", module: "x.mjs" }, manifest })) })).toThrow(/unique/);
  });

  it("rejects self-ordering and duplicate register declarations", () => {
    expect(() => runtimeConfigSchema.parse({ ...base, extensions: [{ trusted: true, source: { kind: "local-module", module: "x.mjs" }, manifest: { ...manifest, ordering: { requires: [manifest.id], before: [], after: [] } } }] })).toThrow(/itself/);
    expect(() => runtimeConfigSchema.parse({ ...base, extensions: [{ trusted: true, source: { kind: "local-module", module: "x.mjs" }, manifest: { ...manifest, contributions: [manifest.contributions[0], manifest.contributions[0]] } }] })).toThrow(/more than once/);
  });
});
