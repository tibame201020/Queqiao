import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(import.meta.dirname, "../../..");

async function text(relative: string): Promise<string> {
  return readFile(path.join(repoRoot, relative), "utf8");
}

describe("extension distribution boundary", () => {
  it("keeps the production Worker and main Queqiao bundle independent from the Git extension package", async () => {
    const workerEntry = await text("apps/worker/src/index.ts");
    const workerPackage = JSON.parse(await text("apps/worker/package.json")) as { dependencies?: Record<string, string> };
    const workerTsconfig = await text("apps/worker/tsconfig.json");
    const packageBuilder = await text("scripts/build-package.mjs");

    expect(workerEntry).not.toContain("@queqiao/extension-git");
    expect(workerPackage.dependencies).not.toHaveProperty("@queqiao/extension-git");
    expect(workerTsconfig).not.toContain("packages/extension-git");
    expect(packageBuilder).not.toContain('"extension-git"');
  });
});
