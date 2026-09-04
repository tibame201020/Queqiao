import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const quickstartAssets = [
  "docs/assets/workstation/quickstart/01-gateway-setup.gif",
  "docs/assets/workstation/quickstart/02-gateway-start.gif",
  "docs/assets/workstation/quickstart/03-worker-setup.gif",
  "docs/assets/workstation/quickstart/04-worker-start.gif",
  "docs/assets/workstation/quickstart/05-create-join-code.gif",
  "docs/assets/workstation/quickstart/06-worker-join.gif",
  "docs/assets/workstation/quickstart/07-gateway-detail.gif",
  "docs/assets/workstation/quickstart/08-copy-mcp-url.gif",
  "docs/assets/workstation/quickstart/09-copy-approval-secret.gif",
] as const;

const rootQuickstartAssets = [
  "docs/assets/workstation/quickstart/01-gateway-setup.gif",
  "docs/assets/workstation/quickstart/03-worker-setup.gif",
  "docs/assets/workstation/quickstart/06-worker-join.gif",
] as const;

const rootExcludedQuickstartAssets = [
  "docs/assets/workstation/quickstart/02-gateway-start.gif",
  "docs/assets/workstation/quickstart/04-worker-start.gif",
  "docs/assets/workstation/quickstart/05-create-join-code.gif",
  "docs/assets/workstation/quickstart/07-gateway-detail.gif",
  "docs/assets/workstation/quickstart/08-copy-mcp-url.gif",
  "docs/assets/workstation/quickstart/09-copy-approval-secret.gif",
] as const;

const controlAssets = [
  "docs/assets/workstation/controls/01-gateways.gif",
  "docs/assets/workstation/controls/02-workers.gif",
  "docs/assets/workstation/controls/03-workspaces.gif",
  "docs/assets/workstation/controls/04-access-profiles.gif",
  "docs/assets/workstation/controls/05-extensions.gif",
  "docs/assets/workstation/controls/06-diagnostics.gif",
  "docs/assets/workstation/controls/07-settings-appearance.gif",
] as const;

const detailAssets = [
  { doc: "gateway", gif: "docs/assets/workstation/details/01-gateway.gif", png: "docs/assets/workstation/details/01-gateway.png" },
  { doc: "worker", gif: "docs/assets/workstation/details/02-worker.gif", png: "docs/assets/workstation/details/02-worker.png" },
  { doc: "workspace", gif: "docs/assets/workstation/details/03-workspace.gif", png: "docs/assets/workstation/details/03-workspace.png" },
  { doc: "access-profile", gif: "docs/assets/workstation/details/04-access-profile.gif", png: "docs/assets/workstation/details/04-access-profile.png" },
  { doc: "extension", gif: "docs/assets/workstation/details/05-extension.gif", png: "docs/assets/workstation/details/05-extension.png" },
  { doc: "diagnostics", gif: "docs/assets/workstation/details/06-diagnostics.gif", png: "docs/assets/workstation/details/06-diagnostics.png" },
] as const;

const workstationGifAssets = [...quickstartAssets, ...controlAssets, ...detailAssets.map((asset) => asset.gif)] as const;
const connectorScreenshot = "docs/assets/workstation/quickstart/10-chatgpt-add-connector.png" as const;

const legacyFlatWorkstationAssets = [
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
  it("keeps the root README compact and task-oriented around the connector-ready Workstation quick start", async () => {
    const readme = await readFile(path.join(repoRoot, "README.md"), "utf8");
    expect(readme.split(/\r?\n/).length).toBeLessThanOrEqual(180);
    expect(readme).toContain("## Quick start — Workstation");
    expect(readme).toContain("queqiao workstation");
    expect(readme).toContain("docs/workstation/README.md");
    expect(readme).toContain("docs/cli/README.md");
    expect(readme).toContain("docs/configuration-persistence.md");
    expect(readme).toContain("docs/cli/reference.md");
    expect(readme).toContain("docs/operations.md");
    for (const asset of rootQuickstartAssets) expect(readme).toContain(asset);
    for (const asset of rootExcludedQuickstartAssets) expect(readme).not.toContain(asset);
    expect(readme).toContain(connectorScreenshot);
    for (const asset of controlAssets) expect(readme).not.toContain(asset);
    expect(readme).not.toContain("docs/assets/workstation/01-overview.gif");
    expect(readme).not.toContain("docs/assets/cli/interactive/01-gateway-setup.gif");
    expect(readme).not.toContain("## Runtime configuration");
    expect(readme).not.toContain("## Project status");
  });

  it("keeps English and Traditional Chinese READMEs aligned on the connector-ready Workstation deployment tasks", async () => {
    const english = await readFile(path.join(repoRoot, "README.md"), "utf8");
    const traditionalChinese = await readFile(path.join(repoRoot, "README.zh-TW.md"), "utf8");
    expect(english).toContain("README.zh-TW.md");
    expect(traditionalChinese).toContain("README.md");
    expect(traditionalChinese).toContain("繁體中文");
    for (const readme of [english, traditionalChinese]) {
      expect(readme).toContain("queqiao workstation");
      expect(readme).toContain("queqiao doctor paths");
      expect(readme).not.toContain("queqiao.cmd");
      for (const asset of rootQuickstartAssets) expect(readme).toContain(asset);
      for (const asset of rootExcludedQuickstartAssets) expect(readme).not.toContain(asset);
      expect(readme).toContain(connectorScreenshot);
    }
    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.files).toContain("README.zh-TW.md");
  });

  it("splits Workstation controls, Appearance, and per-domain Detailed Info into dedicated guides", async () => {
    const guide = await readFile(path.join(repoRoot, "docs/workstation/README.md"), "utf8");
    const guideZh = await readFile(path.join(repoRoot, "docs/workstation/README.zh-TW.md"), "utf8");
    const controls = await readFile(path.join(repoRoot, "docs/workstation/controls.md"), "utf8");
    const controlsZh = await readFile(path.join(repoRoot, "docs/workstation/controls.zh-TW.md"), "utf8");
    const appearance = await readFile(path.join(repoRoot, "docs/workstation/appearance.md"), "utf8");
    const detailIndex = await readFile(path.join(repoRoot, "docs/workstation/details/README.md"), "utf8");
    const detailIndexZh = await readFile(path.join(repoRoot, "docs/workstation/details/README.zh-TW.md"), "utf8");

    for (const required of ["controls.md", "appearance.md", "details/README.md", "../cli/README.md"]) expect(guide).toContain(required);
    for (const required of ["controls.zh-TW.md", "appearance.zh-TW.md", "details/README.zh-TW.md", "../cli/README.md"]) expect(guideZh).toContain(required);
    for (const asset of controlAssets) {
      expect(controls).toContain(asset.replace("docs/", "../"));
      expect(controlsZh).toContain(asset.replace("docs/", "../"));
    }
    expect(appearance).toContain("../assets/workstation/controls/07-settings-appearance.gif");
    expect(appearance).toContain("workstation.yaml");

    for (const asset of detailAssets) {
      expect(detailIndex).toContain(`${asset.doc}.md`);
      expect(detailIndexZh).toContain(`${asset.doc}.zh-TW.md`);
      const page = await readFile(path.join(repoRoot, `docs/workstation/details/${asset.doc}.md`), "utf8");
      const pageZh = await readFile(path.join(repoRoot, `docs/workstation/details/${asset.doc}.zh-TW.md`), "utf8");
      const gifRef = `../../${asset.gif.slice("docs/".length)}`;
      const pngRef = `../../${asset.png.slice("docs/".length)}`;
      expect(page).toContain(gifRef);
      expect(page).toContain(pngRef);
      expect(pageZh).toContain(gifRef);
      expect(pageZh).toContain(pngRef);
    }
  });

  it("keeps the documented Detailed Info tabs aligned with the production tab contract", async () => {
    const source = await readFile(path.join(repoRoot, "apps/cli/src/workstation-detail-ui.tsx"), "utf8");
    for (const labels of [
      ["Status", "Info", "Workers"],
      ["Status", "Info", "Workspaces", "Extensions", "Gateways"],
      ["Info", "Access"],
      ["Info", "Tools", "Commands"],
      ["Info", "Workers"],
      ["Summary", "Core", "Routing", "Extensions", "Warnings"],
    ]) {
      for (const label of labels) expect(source).toContain(`label: "${label}"`);
    }
  });

  it("keeps classic CLI visuals and copyable commands in their dedicated guide", async () => {
    const guide = await readFile(path.join(repoRoot, "docs/cli/interactive/README.md"), "utf8");
    for (const asset of interactiveAssets) expect(guide).toContain(asset.replace("docs/", "../../"));
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

    expect(paths).toContain("QUEQIAO_CONFIG_DIR");
    expect(paths).toContain("QUEQIAO_DATA_DIR");
    expect(paths).toContain("QUEQIAO_STATE_HOME");
    expect(paths).toContain("QUEQIAO_RUNTIME_DIR");
    expect(profiles).toContain('"access-profiles.json"');
    expect(history).toContain('"setup-history.json"');
    expect(extension).toContain('"hub.json"');
    expect(extension).toContain('"packages"');
    expect(membership).toContain('filename = "worker-memberships.json"');
    expect(settings).toContain('"workstation.yaml"');
  });

  it("ships one-shot GIFs and valid Detailed Info screenshots while retiring the old flat Workstation assets", async () => {
    for (const asset of [...interactiveAssets, ...workstationGifAssets]) {
      const data = await readFile(path.join(repoRoot, asset));
      expect(data.length).toBeGreaterThan(10_000);
      expect(data.subarray(0, 6).toString("ascii")).toMatch(/^GIF8[79]a$/);
      expect(data.includes(Buffer.from("NETSCAPE2.0", "ascii"))).toBe(false);
    }
    for (const asset of detailAssets) {
      const data = await readFile(path.join(repoRoot, asset.png));
      expect(data.length).toBeGreaterThan(10_000);
      expect(data.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    }
    const connectorPng = await readFile(path.join(repoRoot, connectorScreenshot));
    expect(connectorPng.length).toBeGreaterThan(10_000);
    expect(connectorPng.subarray(0, 8)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    for (const asset of legacyFlatWorkstationAssets) {
      await expect(access(path.join(repoRoot, asset))).rejects.toMatchObject({ code: "ENOENT" });
    }
  });

  it("documents and enforces the packaged isolated PTY recorder contract", async () => {
    const cliGuide = await readFile(path.join(repoRoot, "docs/cli/interactive/README.md"), "utf8");
    const workstationGuide = await readFile(path.join(repoRoot, "docs/workstation/README.md"), "utf8");
    const sharedRecorder = await readFile(path.join(repoRoot, "scripts/cli-demo/record_interactive.py"), "utf8");
    const workstationRecorder = await readFile(path.join(repoRoot, "scripts/cli-demo/record_workstation.py"), "utf8");
    const wrapper = await readFile(path.join(repoRoot, "scripts/cli-demo/record-workstation.ps1"), "utf8");

    expect(cliGuide).toContain("real packaged Queqiao CLI");
    expect(cliGuide).toContain("pseudo-terminal (PTY)");
    expect(cliGuide).toContain("play once and stop on their final frame");
    expect(workstationGuide).toContain("packaged Queqiao CLI");
    expect(workstationGuide).toContain("isolated PTY");
    expect(sharedRecorder).toContain('"--no-loop"');
    expect(workstationRecorder).toContain("install_fake_clipboard");
    expect(workstationRecorder).toContain("quickstart/07-gateway-detail");
    expect(workstationRecorder).toContain("quickstart/08-copy-mcp-url");
    expect(workstationRecorder).toContain("quickstart/09-copy-approval-secret");
    expect(workstationRecorder).toContain("controls/07-settings-appearance");
    expect(workstationRecorder).toContain("details/06-diagnostics");
    expect(workstationRecorder).not.toContain('session.send(b"q")');
    expect(wrapper).toContain("record_workstation.py");

    const packageJson = JSON.parse(await readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(packageJson.scripts["docs:cli:interactive"]).toContain("record-interactive.ps1");
    expect(packageJson.scripts["docs:workstation"]).toContain("record-workstation.ps1");
    expect(packageJson.scripts["docs:all"]).toContain("docs:workstation");
  });
});