import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const workstationAssets = [
  "docs/assets/workstation/01-overview.gif",
  "docs/assets/workstation/02-gateway.gif",
  "docs/assets/workstation/03-worker.gif",
  "docs/assets/workstation/04-workspace.gif",
  "docs/assets/workstation/05-access-profile.gif",
  "docs/assets/workstation/06-extension.gif",
  "docs/assets/workstation/07-diagnostics.gif",
] as const;
const interactiveAssets = [
  "docs/assets/cli/interactive/01-gateway-setup.gif",
  "docs/assets/cli/interactive/02-gateway-info.gif",
  "docs/assets/cli/interactive/03-worker-access-setup.gif",
  "docs/assets/cli/interactive/04-workspace-management.gif",
  "docs/assets/cli/interactive/05-instance-selector.gif",
  "docs/assets/cli/interactive/06-extension-attach.gif",
  "docs/assets/cli/interactive/07-runtime-start.gif",
  "docs/assets/cli/interactive/08-worker-enrollment.gif",
] as const;

const onboardingCommands = [
  "queqiao gateway setup",
  "queqiao gateway info",
  "queqiao gateway info --detail",
  "queqiao gateway info --copy-url",
  "queqiao gateway info --copy-secret",
  "queqiao worker setup",
  "queqiao workspace",
  "queqiao gateway status",
  "queqiao extension install <npm:package|local-path>",
  "queqiao extension attach",
  "queqiao worker serve --worker <worker> --bg",
  "queqiao gateway serve --gateway <gateway> --bg",
  "queqiao gateway join-token --gateway <gateway>",
  "queqiao worker join --worker <worker>",
] as const;

describe("CLI visual documentation", () => {
  it("keeps the root README compact and Workstation-first", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
    expect(readme.split(/\r?\n/).length).toBeLessThanOrEqual(180);
    expect(readme).toContain("## Quick start — Workstation");
    expect(readme).toContain("queqiao workstation");
    expect(readme).toContain("docs/workstation/README.md");
    expect(readme).toContain("docs/cli/README.md");
    expect(readme).toContain("docs/configuration-persistence.md");
    expect(readme).toContain("docs/cli/reference.md");
    expect(readme).toContain("docs/operations.md");
    for (const asset of workstationAssets) expect(readme).toContain(asset);
    expect(readme).not.toContain("docs/assets/cli/interactive/01-gateway-setup.gif");
    expect(readme).not.toContain("## Runtime configuration");
    expect(readme).not.toContain("## Project status");
  });

  it("keeps English and Traditional Chinese READMEs aligned on Workstation onboarding", async () => {
    const english = await readFile(path.join(repoRoot, "README.md"), "utf8");
    const traditionalChinese = await readFile(path.join(repoRoot, "README.zh-TW.md"), "utf8");
    expect(english).toContain("README.zh-TW.md");
    expect(traditionalChinese).toContain("README.md");
    expect(traditionalChinese).toContain("繁體中文");
    for (const readme of [english, traditionalChinese]) {
      expect(readme).toContain("queqiao workstation");
      expect(readme).toContain("queqiao doctor paths");
      expect(readme).not.toContain("queqiao.cmd");
      for (const asset of workstationAssets) expect(readme).toContain(asset);
    }
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.files).toContain("README.zh-TW.md");
  });

  it("keeps classic CLI visuals and copyable commands in their dedicated guide", async () => {
    const guide = await readFile(path.join(repoRoot, "docs/cli/interactive/README.md"), "utf8");
    for (const asset of interactiveAssets) {
      expect(guide).toContain(asset.replace("docs/", "../../"));
    }
    for (const command of onboardingCommands) expect(guide).toContain(command);

    const reference = await readFile(path.join(repoRoot, "docs/cli/reference.md"), "utf8");
    expect(reference).toContain("queqiao completion powershell | Out-String | Invoke-Expression");
    expect(reference).toContain('eval "$(queqiao completion bash)"');
  });

  it("documents the current config/data/state persistence model from production paths", async () => {
    const guide = await readFile(path.join(repoRoot, "docs/configuration-persistence.md"), "utf8");
    const paths = await readFile(path.join(repoRoot, "packages/platform-paths/src/index.ts"), "utf8");
    const profiles = await readFile(path.join(repoRoot, "apps/cli/src/access-profile-store.ts"), "utf8");
    const history = await readFile(path.join(repoRoot, "apps/cli/src/command-history-input.ts"), "utf8");
    const extension = await readFile(path.join(repoRoot, "apps/cli/src/extension-cli.ts"), "utf8");
    const membership = await readFile(path.join(repoRoot, "apps/gateway/src/worker-membership-store.ts"), "utf8");
    const settings = await readFile(path.join(repoRoot, "apps/cli/src/workstation-settings.ts"), "utf8");

    for (const required of [
      "config.yaml", "oauth-approval.secret", "jwt-signing.secret", "management.secret",
      "worker-memberships.json", "worker-credentials/", "access-profiles.json", "setup-history.json",
      "extensions/", "hub.json", "packages/", "workstation.yaml", "state/processes/", "state/logs/",
      "QUEQIAO_CONFIG_DIR", "QUEQIAO_DATA_DIR", "QUEQIAO_STATE_HOME", "QUEQIAO_RUNTIME_DIR",
    ]) expect(guide).toContain(required);
    expect(guide).toContain("does not maintain a separate production `workspaces.json`");
    expect(guide).toContain("%LOCALAPPDATA%\\Queqiao\\gateways\\<name>\\config\\config.yaml");
    expect(guide).toContain("~/.config/queqiao/gateways/<name>/config.yaml");

    expect(paths).toContain('QUEQIAO_CONFIG_DIR');
    expect(paths).toContain('QUEQIAO_DATA_DIR');
    expect(paths).toContain('QUEQIAO_STATE_HOME');
    expect(paths).toContain('QUEQIAO_RUNTIME_DIR');
    expect(profiles).toContain('"access-profiles.json"');
    expect(history).toContain('"setup-history.json"');
    expect(extension).toContain('"hub.json"');
    expect(extension).toContain('"packages"');
    expect(membership).toContain('filename = "worker-memberships.json"');
    expect(settings).toContain('"workstation.yaml"');
  });
  it("ships one-shot GIF assets that stop on their final frame", async () => {
    for (const asset of [...interactiveAssets, ...workstationAssets]) {
      const data = await readFile(path.join(repoRoot, asset));
      expect(data.length).toBeGreaterThan(10_000);
      expect(data.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a$/);
      expect(data.includes(Buffer.from("NETSCAPE2.0", "ascii"))).toBe(false);
    }
  });

  it("documents and enforces the real PTY recorder contract", async () => {
    const cliGuide = await readFile(path.join(repoRoot, "docs/cli/interactive/README.md"), "utf8");
    const workstationGuide = await readFile(path.join(repoRoot, "docs/workstation/README.md"), "utf8");
    const recorder = await readFile(path.join(repoRoot, "scripts/cli-demo/record_interactive.py"), "utf8");
    expect(cliGuide).toContain("real packaged Queqiao CLI");
    expect(cliGuide).toContain("pseudo-terminal (PTY)");
    expect(cliGuide).toContain("play once and stop on their final frame");
    expect(workstationGuide).toContain("packaged Queqiao CLI");
    expect(workstationGuide).toContain("isolated PTY");
    expect(recorder).toContain('"--no-loop"');
    expect(recorder).toContain('"workstation-all"');

    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.scripts["docs:cli:interactive"]).toContain("record-interactive.ps1");
    expect(packageJson.scripts["docs:workstation"]).toContain("record-workstation.ps1");
    expect(packageJson.scripts["docs:all"]).toContain("docs:workstation");
  });
});