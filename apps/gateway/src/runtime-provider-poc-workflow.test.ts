import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import { describe, expect, it } from "vitest";

describe("GitHub Actions Runtime Provider teardown acceptance", () => {
  it("allows for eventual GitHub run cancellation without dropping the disposed lease assertion", () => {
    const workflowPath = fileURLToPath(
      new URL("../../../.github/workflows/runtime-provider-poc-controller.yml", import.meta.url),
    );
    const workflow = YAML.parse(readFileSync(workflowPath, "utf8")) as {
      jobs: Record<string, { steps: Array<{ name?: string; run?: string }> }>;
    };
    const step = workflow.jobs["phase3-e2e"]?.steps.find(
      ({ name }) => name === "Complete lease and verify provider cancellation",
    );
    expect(step?.run).toBeDefined();
    const script = step?.run ?? "";
    expect(script).toContain('test "$final_state" = "disposed"');
    const poll = script.match(/for i in \{1\.\.(\d+)\}; do/);
    expect(poll).not.toBeNull();
    // A real run took ~77 seconds to reach cancelled after the lease was disposed.
    expect(Number(poll?.[1])).toBeGreaterThanOrEqual(120);
    expect(script).toContain('test "$conclusion" = "cancelled"');
  });
});
