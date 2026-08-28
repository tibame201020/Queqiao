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

  it("stops only resolved Shadow launchers before checking dist", async () => {
    const script = await readFile(scriptUrl, "utf8");
    const workerStop = script.indexOf('Stop-LauncherTree -Launcher $workerLauncher');
    const gatewayStop = script.indexOf('Stop-LauncherTree -Launcher $gatewayLauncher');
    const distCheck = script.indexOf("Wait-RepoDistRelease", gatewayStop);
    expect(workerStop).toBeGreaterThan(-1);
    expect(gatewayStop).toBeGreaterThan(workerStop);
    expect(distCheck).toBeGreaterThan(gatewayStop);
  });

  it("does not restore or remove dist when pre-build process detection fails", async () => {
    const script = await readFile(scriptUrl, "utf8");
    expect(script).toContain("$buildStarted = $false");
    expect(script.indexOf("$buildStarted = $true")).toBeGreaterThan(script.indexOf("Wait-RepoDistRelease"));
    expect(script).toContain("if ($buildStarted -and (Test-Path -LiteralPath $backupDist -PathType Container))");
  });

  it("restores only launchers that were running before a failed refresh", async () => {
    const script = await readFile(scriptUrl, "utf8");
    expect(script).toContain("$gatewayWasRunning = @(Get-LauncherProcesses -Launcher $gatewayLauncher).Count -eq 1");
    expect(script).toContain("$workerWasRunning = @(Get-LauncherProcesses -Launcher $workerLauncher).Count -eq 1");
    expect(script).toContain("if ($gatewayWasRunning)");
    expect(script).toContain("if ($workerWasRunning)");
  });
});
