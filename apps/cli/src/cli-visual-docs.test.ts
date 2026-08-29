import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const repoRawBase = "https://raw.githubusercontent.com/tibame201020/Queqiao/main/";
const interactiveAssets = [
  "docs/assets/cli/interactive/01-gateway-setup.gif",
  "docs/assets/cli/interactive/02-worker-access-setup.gif",
  "docs/assets/cli/interactive/03-instance-selector.gif",
  "docs/assets/cli/interactive/04-extension-attach.gif",
] as const;

describe("CLI visual documentation", () => {
  it("keeps the README onboarding multi-step instead of collapsing to one demo", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
    for (const asset of interactiveAssets) {
      expect(readme).toContain(`${repoRawBase}${asset}`);
    }
    expect(readme).toContain(`${repoRawBase}docs/assets/cli/flows/04-start-enroll-verify.gif`);
    expect(readme).not.toContain("README intentionally keeps only the shortest");
  });

  it("ships real GIF assets for every interactive onboarding step", async () => {
    for (const asset of interactiveAssets) {
      const data = await readFile(path.join(repoRoot, asset));
      expect(data.length).toBeGreaterThan(10_000);
      expect(data.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a$/);
    }
  });

  it("documents the PTY recorder and exposes reproducible npm scripts", async () => {
    const guide = await readFile(path.join(repoRoot, "docs/cli/interactive/README.md"), "utf8");
    expect(guide).toContain("real packaged Queqiao CLI");
    expect(guide).toContain("pseudo-terminal (PTY)");
    expect(guide).toContain("record_interactive.py");

    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.scripts["docs:cli:interactive"]).toContain("record-interactive.ps1");
    expect(packageJson.scripts["docs:cli:all"]).toContain("docs:cli:interactive");
  });
});
