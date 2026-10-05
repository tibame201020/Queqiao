import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

describe("npm release publish contract", () => {
  it("separates validation, artifact build, and publish lifecycle", async () => {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const workflow = await readFile(path.join(root, ".github", "workflows", "publish-npm.yml"), "utf8");

    expect(pkg.scripts.prepack).toBe("npm run build:package");
    expect(pkg.scripts["release:verify-registry"]).toBe("tsx scripts/npm-release-visibility.ts");
    const gate = workflow.indexOf("- run: npm run release:gate");
    const build = workflow.indexOf("- name: Build publish artifact");
    const preflight = workflow.indexOf("release:verify-registry -- --exists-only");
    const publish = workflow.indexOf("npm publish --provenance --access public --ignore-scripts");
    const verify = workflow.indexOf("release:verify-registry -- --timeout-ms");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(gate);
    expect(preflight).toBeGreaterThan(build);
    expect(publish).toBeGreaterThan(preflight);
    expect(verify).toBeGreaterThan(publish);
    expect(workflow).toContain("previously staged version");
  });
});
