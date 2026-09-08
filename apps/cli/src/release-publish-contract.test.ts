import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(import.meta.dirname, "../../..");

describe("npm release publish contract", () => {
  it("separates validation, artifact build, and publish lifecycle", async () => {
    const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")) as { scripts: Record<string, string> };
    const workflow = await readFile(path.join(root, ".github", "workflows", "publish-npm.yml"), "utf8");

    expect(pkg.scripts.prepack).toBe("npm run build:package");
    const gate = workflow.indexOf("- run: npm run release:gate");
    const build = workflow.indexOf("- name: Build publish artifact");
    const publish = workflow.indexOf("npm publish --provenance --access public --ignore-scripts");
    expect(gate).toBeGreaterThanOrEqual(0);
    expect(build).toBeGreaterThan(gate);
    expect(publish).toBeGreaterThan(build);
  });
});
