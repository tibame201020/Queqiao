import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parse } from "yaml";
import { describe, expect, it } from "vitest";

describe("Actions Gate C Worker least-privilege contract", () => {
  it("starts with read-only workspace policy and no command or shell access", () => {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../.github/workflows/runtime-provider-poc-worker.yml");
    const workflow = parse(readFileSync(file, "utf8")) as {
      jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
    };
    const bootstrap = workflow.jobs["runtime-worker"]!.steps.find((step) => step.name === "Bootstrap Worker")?.run ?? "";
    expect(bootstrap).toContain('profile: "read-only"');
    expect(bootstrap).toMatch(/allow: \["workspace_info","read_file","list_workspaces"\]/);
    expect(bootstrap).toContain("commands: { allow: [] }");
    expect(bootstrap).not.toMatch(/allow: \[[^\]]*"(?:run|shell)"[^\]]*\]/);
  });
});
