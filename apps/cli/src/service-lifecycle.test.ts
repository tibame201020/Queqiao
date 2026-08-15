import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { serializeRuntimeConfig } from "@queqiao/config";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { installService, serviceLifecycleInternals, serviceStatus, startService, stopService, uninstallService } from "./service-lifecycle.js";

const cleanup: string[] = [];
afterEach(async () => { await Promise.all(cleanup.splice(0).map((entry) => rm(entry, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-service-test-")); cleanup.push(root);
  const layout: RuntimeLayout = {
    configDir: path.join(root, "config"), dataDir: path.join(root, "data"), stateDir: path.join(root, "state"), logDir: path.join(root, "state", "logs"), runtimeDir: path.join(root, "runtime"), secretsDir: path.join(root, "data", "secrets"), configFile: path.join(root, "config", "config.yaml"), gatewayStateDir: path.join(root, "data", "gateway"),
  };
  await import("node:fs/promises").then(({ mkdir }) => mkdir(layout.configDir, { recursive: true }));
  await writeFile(layout.configFile, serializeRuntimeConfig({
    version: 1,
    gateway: { publicBaseUrl: "https://queqiao.example/stable/", listen: { host: "127.0.0.1", port: 7775 }, managementListen: { host: "127.0.0.1", port: 7774 }, stateDirectory: layout.gatewayStateDir, approvalSecretFile: path.join(layout.secretsDir, "approval.secret"), jwtSigningSecretFile: path.join(layout.secretsDir, "jwt.secret") },
    worker: { workerId: "11111111-1111-4111-8111-111111111111", environmentId: "windows", listen: { host: "127.0.0.1", port: 7776 }, tokenFile: path.join(layout.secretsDir, "worker.secret"), defaultWorkspaceId: "test" },
    workspaces: [{ id: "test", displayName: "Test", root, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
  }), "utf8");
  const nodePath = path.join(root, "node.exe"); const gateway = path.join(root, "queqiao-gateway.js"); const worker = path.join(root, "queqiao-worker.js");
  await Promise.all([writeFile(nodePath, "node"), writeFile(gateway, "gateway"), writeFile(worker, "worker")]);
  return { root, layout, nodePath, gateway, worker };
}

describe("CLI service lifecycle", () => {
  it("installs isolated Windows HKCU Run entries and a one-shot launcher without embedding secrets", async () => {
    const { layout, nodePath, gateway, worker } = await fixture();
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const execFile = async (file: string, args: readonly string[]) => {
      calls.push({ file, args });
      if (file.endsWith("powershell.exe") && args.some((arg) => arg.includes("Start-Process"))) return { stdout: "1234", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const result = await installService(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, nodePath, entryPoints: { gateway, worker } });
    expect(result.manager).toBe("windows-run-key");
    expect(result.serviceName).toBe("Queqiao shadow Gateway");
    const create = calls.at(-1)!;
    expect(create.file).toBe("C:\\Windows\\System32\\reg.exe");
    expect(create.args).toEqual(expect.arrayContaining(["ADD", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", "Queqiao shadow Gateway", "/t", "REG_SZ", "/f"]));
    const launcher = await readFile(result.launcher, "utf8");
    expect(launcher).toContain("QUEQIAO_CONFIG_FILE");
    expect(launcher).toContain("detached:true");
    expect(launcher).toContain("queqiao-gateway.js");
    expect(launcher).not.toContain("approval.secret");
    expect(launcher).not.toContain("worker.secret");
    expect(serviceLifecycleInternals.windowsRunValueName("stable", "gateway")).not.toBe(serviceLifecycleInternals.windowsRunValueName("shadow", "gateway"));

    const paths = serviceLifecycleInternals.servicePaths(layout, "shadow", "gateway", "win32");
    await startService(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, fetchImpl: async () => { throw new Error("offline"); }, nodePath, entryPoints: { gateway, worker } });
    expect(calls.some(({ file, args }) => file.endsWith("powershell.exe") && args.some((arg) => arg.includes("Start-Process")))).toBe(true);
    expect(JSON.parse(await readFile(paths.pidFile, "utf8"))).toMatchObject({ pid: 1234 });
    const status = await serviceStatus(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, fetchImpl: async () => new Response("{}", { status: 200 }) });
    expect(status).toMatchObject({ installed: true, active: true, health: { reachable: true, healthy: true, status: 200 } });

    await writeFile(paths.pidFile, JSON.stringify({ pid: 1234 }), "utf8");
    const stopExec = async (file: string, args: readonly string[]) => {
      calls.push({ file, args });
      if (file.endsWith("powershell.exe")) return { stdout: `\"${nodePath}\" \"${gateway}\"`, stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const stopped = await stopService(layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile: stopExec, entryPoints: { gateway } });
    expect(stopped.stopped).toBe(true);
    expect(calls.some(({ file, args }) => file.endsWith("taskkill.exe") && args.includes("1234"))).toBe(true);
    await uninstallService(layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile: stopExec, entryPoints: { gateway } });
    expect(calls.some(({ file, args }) => file.endsWith("reg.exe") && args.includes("DELETE"))).toBe(true);
  });

  it("refuses to kill a stale Windows PID that belongs to another process", async () => {
    const { layout, gateway } = await fixture();
    const paths = serviceLifecycleInternals.servicePaths(layout, "stable", "gateway", "win32");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(paths.serviceDir, { recursive: true }));
    await writeFile(paths.pidFile, JSON.stringify({ pid: 4321 }), "utf8");
    const execFile = async (file: string, _args: readonly string[]) => file.endsWith("powershell.exe") ? { stdout: "node.exe C:\\unrelated\\server.js", stderr: "" } : { stdout: "", stderr: "" };
    await expect(stopService(layout, "gateway", "stable", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, entryPoints: { gateway } })).rejects.toThrow(/Refusing to stop PID/);
  });

  it("installs a hardened user systemd unit and keeps instance names isolated", async () => {
    const { root, layout, nodePath, gateway, worker } = await fixture();
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const execFile = async (file: string, args: readonly string[]) => { calls.push({ file, args }); return { stdout: "", stderr: "" }; };
    const systemdUserDirectory = path.join(root, "systemd-user");
    const result = await installService(layout.configFile, layout, "worker", "shadow", { platform: "linux", execFile, nodePath, entryPoints: { gateway, worker }, systemdUserDirectory });
    expect(result.manager).toBe("systemd-user");
    expect(result.serviceName).toBe("queqiao-shadow-worker.service");
    const unit = await readFile(path.join(systemdUserDirectory, result.serviceName), "utf8");
    expect(unit).toContain("NoNewPrivileges=true");
    expect(unit).toContain("PrivateTmp=true");
    expect(unit).toContain("ExecStart=/bin/sh");
    expect(calls).toContainEqual({ file: "systemctl", args: ["--user", "enable", "queqiao-shadow-worker.service"] });
    expect(serviceLifecycleInternals.systemdUnitName("stable", "worker")).not.toBe(serviceLifecycleInternals.systemdUnitName("shadow", "worker"));

    await startService(layout.configFile, layout, "worker", "shadow", { platform: "linux", execFile });
    const status = await serviceStatus(layout.configFile, layout, "worker", "shadow", { platform: "linux", execFile, fetchImpl: async () => new Response("{}", { status: 200 }) });
    expect(status).toMatchObject({ installed: true, active: true, health: { reachable: true, healthy: true } });
    await stopService(layout, "worker", "shadow", { platform: "linux", execFile });
    await uninstallService(layout, "worker", "shadow", { platform: "linux", execFile, systemdUserDirectory });
    await expect(readFile(path.join(systemdUserDirectory, result.serviceName), "utf8")).rejects.toThrow();
  });

  it("does not duplicate-start a reachable Windows role when no managed PID exists", async () => {
    const { layout, nodePath, gateway, worker } = await fixture();
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const execFile = async (file: string, args: readonly string[]) => { calls.push({ file, args }); return { stdout: "", stderr: "" }; };
    const paths = serviceLifecycleInternals.servicePaths(layout, "shadow", "gateway", "win32");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(paths.serviceDir, { recursive: true }));
    await writeFile(paths.launcher, "launcher", "utf8");
    const result = await startService(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, fetchImpl: async () => new Response("{}", { status: 200 }), nodePath, entryPoints: { gateway, worker } });
    expect(result).toMatchObject({ started: false, alreadyRunning: true, managed: false });
    expect(calls.some(({ file, args }) => file.endsWith("powershell.exe") && args.some((arg) => arg.includes("Start-Process")))).toBe(false);
  });

  it("rejects unsafe service instance identifiers before touching the OS manager", async () => {
    const { layout } = await fixture();
    await expect(installService(layout.configFile, layout, "gateway", "../shadow", { platform: "linux", execFile: async () => ({ stdout: "", stderr: "" }) })).rejects.toThrow(/Service instance/);
  });
});
