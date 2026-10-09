import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("Actions Gate C short-task Worker least-privilege contract", () => {
  it("permits Node CLI via run only in the ephemeral runtime workspace", () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows/runtime-provider-poc-worker.yml");
    const workflow = parse(readFileSync(file, "utf8")) as {
      jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
    };
    const bootstrap = workflow.jobs["runtime-worker"]!.steps.find((step) => step.name === "Bootstrap Worker")?.run ?? "";
    expect(bootstrap).toContain('root: process.env.GITHUB_WORKSPACE');
    expect(bootstrap).toContain('profile: "coding"');
    expect(bootstrap).toContain('allow: ["workspace_info","read_file","list_workspaces","run"]');
    expect(bootstrap).toContain('allow: ["node"]');
    expect(bootstrap).toContain('exact: [{');
    expect(bootstrap).toContain('executable: "node"');
    expect(bootstrap).toContain('args: ["node_modules/vitest/vitest.mjs", "run", "apps/gateway/src/actions-mcp-poc.test.ts", "--maxWorkers=2"]');
    expect(bootstrap).toContain('cwd: "."');
    expect(bootstrap).toContain('mode: "sync"');
    expect(bootstrap).toContain('maxTimeoutMs: 45000');
    expect(bootstrap).not.toMatch(/allow: \[[^\]]*"shell"[^\]]*\]/);
    expect(bootstrap).not.toContain('command:');
  });
});
