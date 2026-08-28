import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const scriptUrl = new URL("../../../scripts/refresh-shadow-runtime.ps1", import.meta.url);

describe("refresh-shadow-runtime script", () => {
  it("detects direct repo dist consumers and refuses to kill unrelated runtimes", async () => {
    const script = await readFile(scriptUrl, "utf8");
    expect(script).toContain("function Get-RepoDistProcesses");
    expect(script).toContain("Join-Path $repoRoot 'dist'");
    expect(script).toContain("$commandLine.Contains($distPrefix)");
    expect(script).toContain("No unrelated runtime was stopped automatically.");
    expect(script).not.toMatch(/Stop-Process[^\r\n]*Get-RepoDistProcesses/);
    expect(script).not.toMatch(/taskkill[^\r\n]*Get-RepoDistProcesses/);
  });

  it("uses named CLI lifecycle for Shadow runtime ownership", async () => {
    const script = await readFile(scriptUrl, "utf8");
    expect(script).toContain("function Get-RoleStatus");
    expect(script).toContain("function Stop-NamedRole");
    expect(script).toContain("function Start-NamedRole");
    expect(script).toContain("@($cli, $Role, 'stop', '--name', $Name)");
    expect(script).toContain("@($cli, $Role, 'serve', '--bg', '--name', $Name)");
    expect(script).not.toContain("Stop-LauncherTree -Launcher $workerLauncher");
    expect(script).not.toContain("Start-Launcher -Launcher $workerLauncher");
  });

  it("does not restore or remove dist when pre-build process detection fails", async () => {
    const script = await readFile(scriptUrl, "utf8");
    expect(script).toContain("$buildStarted = $false");
    expect(script.indexOf("$buildStarted = $true")).toBeGreaterThan(script.indexOf("Wait-RepoDistRelease"));
    expect(script).toContain("if ($buildStarted -and (Test-Path -LiteralPath $backupDist -PathType Container))");
  });

  it("restores only named roles that were active before a failed refresh", async () => {
    const script = await readFile(scriptUrl, "utf8");
    expect(script).toContain("$gatewayWasRunning = (Get-RoleStatus -Role 'gateway' -Name $GatewayName).active -eq $true");
    expect(script).toContain("$workerWasRunning = (Get-RoleStatus -Role 'worker' -Name $WorkerName).active -eq $true");
    expect(script).toContain("if ($gatewayWasRunning)");
    expect(script).toContain("if ($workerWasRunning)");
  });

  it("treats the named Worker config as authoritative instead of launcher overrides", async () => {
    const script = await readFile(scriptUrl, "utf8");
    expect(script).toContain('Join-Path $queqiaoRoot "workers\\$WorkerName\\config\\config.yaml"');
    expect(script).not.toContain("function Resolve-WorkerConfigFromLauncher");
    expect(script).not.toContain("$workerConfig = Resolve-WorkerConfigFromLauncher");
  });
});
