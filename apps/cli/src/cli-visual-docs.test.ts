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
  "docs/assets/cli/interactive/05-runtime-start.gif",
  "docs/assets/cli/interactive/06-worker-enrollment.gif",
] as const;

const onboardingCommands = [
  "queqiao gateway setup",
  "queqiao worker setup",
  "queqiao gateway status",
  "queqiao extension install <npm:package|local-path>",
  "queqiao extension attach",
  "queqiao worker serve --worker <worker> --bg",
  "queqiao gateway serve --gateway <gateway> --bg",
  "queqiao gateway join-token --gateway <gateway>",
  "queqiao worker join --worker <worker>",
  "queqiao gateway workers list --gateway <gateway>",
] as const;

describe("CLI visual documentation", () => {
  it("keeps the root README focused on install and first-deployment usage", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
    expect(readme.split(/\r?\n/).length).toBeLessThanOrEqual(180);
    expect(readme).toContain("## First deployment");
    expect(readme).toContain("docs/cli/reference.md");
    expect(readme).toContain("docs/operations.md");
    expect(readme).not.toContain("## CLI baseline");
    expect(readme).not.toContain("## Runtime configuration");
    expect(readme).not.toContain("## Project status");
  });

  it("keeps every onboarding step copyable and in the same interactive visual series", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
    for (const asset of interactiveAssets) {
      expect(readme).toContain(`${repoRawBase}${asset}`);
    }
    for (const command of onboardingCommands) {
      expect(readme).toContain(command);
    }
    expect(readme).not.toContain("docs/assets/cli/flows/04-start-enroll-verify.gif");
  });

  it("ships one-shot GIF assets that stop on their final frame", async () => {
    for (const asset of interactiveAssets) {
      const data = await readFile(path.join(repoRoot, asset));
      expect(data.length).toBeGreaterThan(10_000);
      expect(data.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a$/);
      expect(data.includes(Buffer.from("NETSCAPE2.0", "ascii"))).toBe(false);
    }
  });

  it("documents and enforces the real PTY recorder contract", async () => {
    const guide = await readFile(path.join(repoRoot, "docs/cli/interactive/README.md"), "utf8");
    const recorder = await readFile(path.join(repoRoot, "scripts/cli-demo/record_interactive.py"), "utf8");
    expect(guide).toContain("real packaged Queqiao CLI");
    expect(guide).toContain("pseudo-terminal (PTY)");
    expect(guide).toContain("play once and stop on their final frame");
    expect(recorder).toContain('"--no-loop"');

    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.scripts["docs:cli:interactive"]).toContain("record-interactive.ps1");
    expect(packageJson.scripts["docs:cli:all"]).toContain("docs:cli:interactive");
  });
});
