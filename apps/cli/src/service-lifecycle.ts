import { execFile as execFileCallback } from "node:child_process";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readRuntimeConfig } from "@queqiao/config";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { secureRuntimeDirectory, secureRuntimeFile } from "./secure-runtime-paths.js";

export type ServiceRole = "gateway" | "worker";
export type ServiceManager = "windows-run-key" | "systemd-user";

type ExecFile = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;

type ServiceDependencies = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFile;
  fetchImpl?: typeof fetch;
  nodePath?: string;
  entryPoints?: Partial<Record<ServiceRole, string>>;
  systemdUserDirectory?: string;
};

const execFileAsync = promisify(execFileCallback);

function defaultExecFile(file: string, args: readonly string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync(file, [...args], { encoding: "utf8", windowsHide: true }).then(({ stdout, stderr }) => ({ stdout, stderr }));
}

function validateInstance(value: string): string {
  if (!/^[a-z][a-z0-9-]{0,31}$/.test(value)) throw new Error("Service instance must match ^[a-z][a-z0-9-]{0,31}$");
  return value;
}

function validateRole(value: string): ServiceRole {
  if (value !== "gateway" && value !== "worker") throw new Error("Service role must be gateway or worker");
  return value;
}

function windowsSystemExecutable(name: string, env: NodeJS.ProcessEnv): string {
  const root = env.SystemRoot || env.WINDIR;
  if (!root) throw new Error("Windows system root is unavailable");
  return path.win32.join(root, "System32", name);
}

function packageEntryPoint(role: ServiceRole): string {
  const directory = path.dirname(fileURLToPath(import.meta.url));
  return path.join(directory, role === "gateway" ? "queqiao-gateway.js" : "queqiao-worker.js");
}

function windowsRunValueName(instance: string, role: ServiceRole): string {
  return `Queqiao ${instance} ${role === "gateway" ? "Gateway" : "Worker"}`;
}

function systemdUnitName(instance: string, role: ServiceRole): string {
  return `queqiao-${instance}-${role}.service`;
}

function shellQuote(value: string): string {
  if (value.includes("\0")) throw new Error("Service path contains NUL");
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function systemdQuote(value: string): string {
  if (/\r|\n/.test(value)) throw new Error("Service path contains a newline");
  return `"${value.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function windowsRunCommand(nodePath: string, launcher: string): string {
  if (/\r|\n|"/.test(nodePath) || /\r|\n|"/.test(launcher)) throw new Error("Service path contains unsupported Windows command characters");
  return `"${nodePath}" "${launcher}"`;
}

async function exists(file: string): Promise<boolean> {
  try { await access(file); return true; } catch { return false; }
}

async function roleHealth(configFile: string, role: ServiceRole, fetchImpl: typeof fetch): Promise<{ reachable: boolean; healthy: boolean; status?: number; error?: string }> {
  try {
    const runtime = await readRuntimeConfig(configFile);
    const port = role === "gateway" ? runtime.gateway?.listen.port : runtime.worker?.listen.port;
    if (!port) return { reachable: false, healthy: false, error: `${role} configuration is required` };
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    return { reachable: true, healthy: response.ok, status: response.status };
  } catch (error) {
    return { reachable: false, healthy: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}

function servicePaths(layout: RuntimeLayout, instance: string, role: ServiceRole, platform: NodeJS.Platform, systemdUserDirectory?: string) {
  const serviceDir = path.join(layout.stateDir, "services", instance);
  const launcher = path.join(serviceDir, platform === "win32" ? `${role}-launcher.mjs` : `${role}.sh`);
  const pidFile = path.join(serviceDir, `${role}.pid.json`);
  const stdout = path.join(layout.logDir, `${instance}-${role}.out.log`);
  const stderr = path.join(layout.logDir, `${instance}-${role}.err.log`);
  const home = os.homedir();
  const unitDirectory = systemdUserDirectory || path.join(process.env.XDG_CONFIG_HOME || path.join(home, ".config"), "systemd", "user");
  const unitName = systemdUnitName(instance, role);
  return { serviceDir, launcher, pidFile, stdout, stderr, unitDirectory, unitName, unitFile: path.join(unitDirectory, unitName) };
}

async function validateConfiguredRole(configFile: string, role: ServiceRole) {
  const runtime = await readRuntimeConfig(configFile);
  if (role === "gateway" && !runtime.gateway) throw new Error("gateway configuration is required before service install");
  if (role === "worker" && !runtime.worker) throw new Error("worker configuration is required before service install");
  return runtime;
}

function windowsLauncherSource(nodePath: string, entryPoint: string, configFile: string, stdout: string, stderr: string, pidFile: string): string {
  return [
    'import { spawn } from "node:child_process";',
    'import { open, writeFile } from "node:fs/promises";',
    'import path from "node:path";',
    `const nodePath=${JSON.stringify(nodePath)};`,
    `const entryPoint=${JSON.stringify(entryPoint)};`,
    `const configFile=${JSON.stringify(configFile)};`,
    `const stdoutFile=${JSON.stringify(stdout)};`,
    `const stderrFile=${JSON.stringify(stderr)};`,
    `const pidFile=${JSON.stringify(pidFile)};`,
    'const stdout=await open(stdoutFile,"a",0o600);',
    'const stderr=await open(stderrFile,"a",0o600);',
    'const child=spawn(nodePath,[entryPoint],{cwd:path.dirname(entryPoint),detached:true,windowsHide:true,stdio:["ignore",stdout.fd,stderr.fd],env:{...process.env,QUEQIAO_CONFIG_FILE:configFile}});',
    'if(!child.pid) throw new Error("Queqiao service process did not return a PID");',
    'await writeFile(pidFile,`${JSON.stringify({pid:child.pid,entryPoint,configFile,startedAt:new Date().toISOString()})}\\n`,{encoding:"utf8",mode:0o600});',
    'child.unref();',
    'process.exit(0);',
    '',
  ].join("\n");
}

async function readPid(pidFile: string): Promise<number | undefined> {
  try {
    const parsed = JSON.parse(await readFile(pidFile, "utf8")) as { pid?: unknown };
    return Number.isInteger(parsed.pid) && Number(parsed.pid) > 0 ? Number(parsed.pid) : undefined;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function stopWindowsProcess(paths: ReturnType<typeof servicePaths>, entryPoint: string, env: NodeJS.ProcessEnv, execFile: ExecFile): Promise<boolean> {
  const pid = await readPid(paths.pidFile);
  if (!pid) return false;
  const powershell = windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe", env);
  const query = `$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if($p){[Console]::Out.Write($p.CommandLine)}`;
  const { stdout } = await execFile(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", query]);
  if (!stdout.trim()) { await rm(paths.pidFile, { force: true }); return false; }
  if (!stdout.toLowerCase().includes(path.resolve(entryPoint).toLowerCase())) throw new Error(`Refusing to stop PID ${pid}: process identity does not match the Queqiao ${path.basename(entryPoint)} entry point`);
  await execFile(windowsSystemExecutable("taskkill.exe", env), ["/PID", String(pid), "/T", "/F"]);
  await rm(paths.pidFile, { force: true });
  return true;
}

export async function installService(configFile: string, layout: RuntimeLayout, roleValue: string, instanceValue: string, dependencies: ServiceDependencies = {}) {
  const role = validateRole(roleValue);
  const instance = validateInstance(instanceValue);
  const platform = dependencies.platform || process.platform;
  if (platform !== "win32" && platform !== "linux") throw new Error(`Service lifecycle is not supported on platform: ${platform}`);
  await validateConfiguredRole(configFile, role);
  const env = dependencies.env || process.env;
  const execFile = dependencies.execFile || defaultExecFile;
  const nodePath = path.resolve(dependencies.nodePath || process.execPath);
  const entryPoint = path.resolve(dependencies.entryPoints?.[role] || packageEntryPoint(role));
  const paths = servicePaths(layout, instance, role, platform, dependencies.systemdUserDirectory);
  await secureRuntimeDirectory(paths.serviceDir);
  await secureRuntimeDirectory(layout.logDir);

  if (platform === "win32") {
    await writeFile(paths.launcher, windowsLauncherSource(nodePath, entryPoint, path.resolve(configFile), paths.stdout, paths.stderr, paths.pidFile), { encoding: "utf8", mode: 0o600 });
    await secureRuntimeFile(paths.launcher);
    const valueName = windowsRunValueName(instance, role);
    const reg = windowsSystemExecutable("reg.exe", env);
    await execFile(reg, ["ADD", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", valueName, "/t", "REG_SZ", "/d", windowsRunCommand(nodePath, paths.launcher), "/f"]);
    return { installed: true, manager: "windows-run-key" as const, instance, role, serviceName: valueName, launcher: paths.launcher };
  }

  const launcher = [
    "#!/bin/sh",
    "set -eu",
    `export QUEQIAO_CONFIG_FILE=${shellQuote(path.resolve(configFile))}`,
    `exec ${shellQuote(nodePath)} ${shellQuote(entryPoint)} >> ${shellQuote(paths.stdout)} 2>> ${shellQuote(paths.stderr)}`,
    "",
  ].join("\n");
  await writeFile(paths.launcher, launcher, { encoding: "utf8", mode: 0o600 });
  await secureRuntimeFile(paths.launcher);
  await mkdir(paths.unitDirectory, { recursive: true, mode: 0o700 });
  const unit = [
    "[Unit]",
    `Description=Queqiao ${instance} ${role}`,
    "After=network.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=/bin/sh ${systemdQuote(paths.launcher)}`,
    "Restart=on-failure",
    "RestartSec=2",
    "NoNewPrivileges=true",
    "PrivateTmp=true",
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
  await writeFile(paths.unitFile, unit, { encoding: "utf8", mode: 0o600 });
  await execFile("systemctl", ["--user", "daemon-reload"]);
  await execFile("systemctl", ["--user", "enable", paths.unitName]);
  return { installed: true, manager: "systemd-user" as const, instance, role, serviceName: paths.unitName, launcher: paths.launcher };
}

export async function startService(configFile: string, layout: RuntimeLayout, roleValue: string, instanceValue: string, dependencies: ServiceDependencies = {}) {
  const role = validateRole(roleValue); const instance = validateInstance(instanceValue); const platform = dependencies.platform || process.platform;
  const execFile = dependencies.execFile || defaultExecFile; const env = dependencies.env || process.env;
  await validateConfiguredRole(configFile, role);
  const nodePath = path.resolve(dependencies.nodePath || process.execPath);
  const entryPoint = path.resolve(dependencies.entryPoints?.[role] || packageEntryPoint(role));
  const paths = servicePaths(layout, instance, role, platform, dependencies.systemdUserDirectory);
  if (platform === "win32") {
    if (!(await exists(paths.launcher))) throw new Error(`Service is not installed: ${windowsRunValueName(instance, role)}`);
    const previousPid = await readPid(paths.pidFile);
    const health = await roleHealth(configFile, role, dependencies.fetchImpl || fetch);
    if (health.reachable) return { started: false, alreadyRunning: true, managed: Boolean(previousPid), instance, role, ...(previousPid ? { pid: previousPid } : {}) };
    if (previousPid) await stopWindowsProcess(paths, entryPoint, env, execFile);
    await rm(paths.pidFile, { force: true });
    const ps = windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe", env);
    const quote = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const command = `$env:QUEQIAO_CONFIG_FILE=${quote(path.resolve(configFile))}; $p=Start-Process -FilePath ${quote(nodePath)} -ArgumentList @(${quote(entryPoint)}) -WorkingDirectory ${quote(path.dirname(entryPoint))} -WindowStyle Hidden -PassThru; [Console]::Out.Write($p.Id)`;
    const { stdout } = await execFile(ps, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command]);
    const pid = Number(stdout.trim());
    if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Queqiao ${role} start did not return a valid PID`);
    await writeFile(paths.pidFile, `${JSON.stringify({ pid, entryPoint, configFile: path.resolve(configFile), startedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 });
    await secureRuntimeFile(paths.pidFile);
  } else if (platform === "linux") await execFile("systemctl", ["--user", "start", systemdUnitName(instance, role)]);
  else throw new Error(`Service lifecycle is not supported on platform: ${platform}`);
  return { started: true, instance, role };
}

export async function stopService(layout: RuntimeLayout, roleValue: string, instanceValue: string, dependencies: ServiceDependencies = {}) {
  const role = validateRole(roleValue); const instance = validateInstance(instanceValue); const platform = dependencies.platform || process.platform;
  const execFile = dependencies.execFile || defaultExecFile; const env = dependencies.env || process.env;
  const entryPoint = path.resolve(dependencies.entryPoints?.[role] || packageEntryPoint(role));
  const paths = servicePaths(layout, instance, role, platform, dependencies.systemdUserDirectory);
  if (platform === "win32") return { stopped: await stopWindowsProcess(paths, entryPoint, env, execFile), instance, role };
  if (platform === "linux") { await execFile("systemctl", ["--user", "stop", systemdUnitName(instance, role)]); return { stopped: true, instance, role }; }
  throw new Error(`Service lifecycle is not supported on platform: ${platform}`);
}

export async function serviceStatus(configFile: string, layout: RuntimeLayout, roleValue: string, instanceValue: string, dependencies: ServiceDependencies = {}) {
  const role = validateRole(roleValue); const instance = validateInstance(instanceValue); const platform = dependencies.platform || process.platform;
  const execFile = dependencies.execFile || defaultExecFile; const env = dependencies.env || process.env; const fetchImpl = dependencies.fetchImpl || fetch;
  let installed = false; let active: boolean | undefined;
  try {
    if (platform === "win32") {
      await execFile(windowsSystemExecutable("reg.exe", env), ["QUERY", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", windowsRunValueName(instance, role)]);
      installed = true;
    } else if (platform === "linux") {
      await execFile("systemctl", ["--user", "is-enabled", systemdUnitName(instance, role)]); installed = true;
      try { await execFile("systemctl", ["--user", "is-active", systemdUnitName(instance, role)]); active = true; } catch { active = false; }
    } else throw new Error(`Service lifecycle is not supported on platform: ${platform}`);
  } catch (error) {
    if (platform !== "win32" && platform !== "linux") throw error;
  }
  const health = await roleHealth(configFile, role, fetchImpl);
  if (platform === "win32") active = health.reachable;
  return { instance, role, manager: (platform === "win32" ? "windows-run-key" : "systemd-user") as ServiceManager, installed, ...(active === undefined ? {} : { active }), health };
}

export async function uninstallService(layout: RuntimeLayout, roleValue: string, instanceValue: string, dependencies: ServiceDependencies = {}) {
  const role = validateRole(roleValue); const instance = validateInstance(instanceValue); const platform = dependencies.platform || process.platform;
  const execFile = dependencies.execFile || defaultExecFile; const env = dependencies.env || process.env;
  const paths = servicePaths(layout, instance, role, platform, dependencies.systemdUserDirectory);
  if (platform === "win32") {
    const entryPoint = path.resolve(dependencies.entryPoints?.[role] || packageEntryPoint(role));
    await stopWindowsProcess(paths, entryPoint, env, execFile);
    await execFile(windowsSystemExecutable("reg.exe", env), ["DELETE", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", windowsRunValueName(instance, role), "/f"]).catch(() => undefined);
  } else if (platform === "linux") {
    await execFile("systemctl", ["--user", "disable", "--now", paths.unitName]).catch(() => undefined);
    await rm(paths.unitFile, { force: true });
    await execFile("systemctl", ["--user", "daemon-reload"]);
  } else throw new Error(`Service lifecycle is not supported on platform: ${platform}`);
  await rm(paths.launcher, { force: true });
  await rm(paths.pidFile, { force: true });
  return { uninstalled: true, instance, role };
}

export const serviceLifecycleInternals = { validateInstance, windowsRunValueName, systemdUnitName, servicePaths, windowsRunCommand };
