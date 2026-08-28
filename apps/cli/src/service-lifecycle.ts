import { execFile as execFileCallback, spawn } from "node:child_process";
import { access, mkdir, open, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { readRuntimeConfig } from "@queqiao/config";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { secureRuntimeDirectory, secureRuntimeFile } from "./secure-runtime-paths.js";

export type RuntimeRole = "gateway" | "worker";
type ExecFile = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
type Dependencies = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFile;
  fetchImpl?: typeof fetch;
  nodePath?: string;
  entryPoints?: Partial<Record<RuntimeRole, string>>;
};
const execFileAsync = promisify(execFileCallback);
function defaultExecFile(file: string, args: readonly string[]) { return execFileAsync(file, [...args], { encoding: "utf8", windowsHide: true }).then(({ stdout, stderr }) => ({ stdout, stderr })); }
function validateName(value: string) { if (!/^[a-z][a-z0-9-]{0,31}$/.test(value)) throw new Error("Name must match ^[a-z][a-z0-9-]{0,31}$"); return value; }
function validateRole(value: string): RuntimeRole { if (value !== "gateway" && value !== "worker") throw new Error("Role must be gateway or worker"); return value; }
function packageEntryPoint(role: RuntimeRole) { const dir = path.dirname(fileURLToPath(import.meta.url)); return path.join(dir, role === "gateway" ? "queqiao-gateway.js" : "queqiao-worker.js"); }
function windowsSystemExecutable(name: string, env: NodeJS.ProcessEnv) { const root = env.SystemRoot || env.WINDIR; if (!root) throw new Error("Windows system root is unavailable"); return path.win32.join(root, "System32", name); }
function pathsFor(layout: RuntimeLayout, role: RuntimeRole) { const dir = path.join(layout.stateDir, "processes"); return { dir, pidFile: path.join(dir, `${role}.pid.json`), stdout: path.join(layout.logDir, `${role}.out.log`), stderr: path.join(layout.logDir, `${role}.err.log`) }; }
async function exists(file: string) { try { await access(file); return true; } catch { return false; } }
async function validateConfiguredRole(configFile: string, role: RuntimeRole) { const runtime = await readRuntimeConfig(configFile); if (role === "gateway" && !runtime.gateway) throw new Error("gateway setup is required before serve"); if (role === "worker" && !runtime.worker) throw new Error("worker setup is required before serve"); if (role === "worker" && !runtime.worker?.defaultWorkspaceId) throw new Error("Worker has no Workspace; run worker workspace add --worker <name> before serving"); return runtime; }
async function health(configFile: string, role: RuntimeRole, fetchImpl: typeof fetch) {
  try {
    const runtime = await readRuntimeConfig(configFile);
    const port = role === "gateway" ? runtime.gateway?.listen.port : runtime.worker?.listen.port;
    if (!port) return { reachable: false, healthy: false, identityMatches: false, error: `${role} configuration is required` };
    const response = await fetchImpl(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(3000) });
    if (role === "gateway") return { reachable: true, healthy: response.ok, identityMatches: true, status: response.status };
    if (!response.ok) return { reachable: true, healthy: false, identityMatches: false, status: response.status };
    const expected = runtime.worker;
    if (!expected) return { reachable: true, healthy: false, identityMatches: false, status: response.status, error: "worker configuration is required" };
    const workerToken = (await readFile(path.resolve(expected.tokenFile), "utf8")).trim();
    if (Buffer.byteLength(workerToken) < 32) return { reachable: true, healthy: false, identityMatches: false, status: response.status, error: "Worker credential is unavailable" };
    const identityResponse = await fetchImpl(`http://127.0.0.1:${port}/enrollment/identity`, { headers: { "x-queqiao-worker-token": workerToken }, signal: AbortSignal.timeout(3000) });
    if (!identityResponse.ok) return { reachable: true, healthy: false, identityMatches: false, status: response.status, error: `Worker identity probe failed with HTTP ${identityResponse.status}` };
    const identity = await identityResponse.json() as { workerId?: unknown; environmentId?: unknown };
    const identityMatches = identity.workerId === expected.workerId && identity.environmentId === expected.environmentId;
    return { reachable: true, healthy: identityMatches, identityMatches, status: response.status, ...(identityMatches ? {} : { error: "Worker identity does not match this configuration" }) };
  } catch (error) {
    return { reachable: false, healthy: false, identityMatches: false, error: error instanceof Error ? error.message : "Unknown error" };
  }
}
async function readPid(file: string) { try { const parsed = JSON.parse(await readFile(file, "utf8")) as { pid?: unknown }; return Number.isInteger(parsed.pid) && Number(parsed.pid) > 0 ? Number(parsed.pid) : undefined; } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; } }
async function processCommandLine(pid: number, platform: NodeJS.Platform, env: NodeJS.ProcessEnv, execFile: ExecFile) {
  if (platform === "win32") { const ps = windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe", env); const query = `$p=Get-CimInstance Win32_Process -Filter \"ProcessId = ${pid}\" -ErrorAction SilentlyContinue; if($p){[Console]::Out.Write($p.CommandLine)}`; return (await execFile(ps, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", query])).stdout.trim(); }
  try { return (await execFile("ps", ["-p", String(pid), "-o", "args="])).stdout.trim(); } catch { return ""; }
}
async function reconcileManagedPid(layout: RuntimeLayout, role: RuntimeRole, dependencies: Dependencies = {}) {
  const platform = dependencies.platform || process.platform; const env = dependencies.env || process.env; const execFile = dependencies.execFile || defaultExecFile; const entryPoint = path.resolve(dependencies.entryPoints?.[role] || packageEntryPoint(role)); const p = pathsFor(layout, role); const pid = await readPid(p.pidFile); if (!pid) return undefined;
  const command = await processCommandLine(pid, platform, env, execFile);
  if (!command || !command.toLowerCase().includes(entryPoint.toLowerCase())) { await rm(p.pidFile, { force: true }); return undefined; }
  return pid;
}
async function stopManaged(layout: RuntimeLayout, role: RuntimeRole, dependencies: Dependencies = {}) {
  const platform = dependencies.platform || process.platform; const env = dependencies.env || process.env; const execFile = dependencies.execFile || defaultExecFile; const p = pathsFor(layout, role); const pid = await reconcileManagedPid(layout, role, dependencies); if (!pid) return false;
  if (platform === "win32") await execFile(windowsSystemExecutable("taskkill.exe", env), ["/PID", String(pid), "/T", "/F"]); else await execFile("kill", ["-TERM", String(pid)]);
  await rm(p.pidFile, { force: true }); return true;
}

export async function startRuntime(configFile: string, layout: RuntimeLayout, roleValue: string, nameValue: string, dependencies: Dependencies = {}) {
  const role = validateRole(roleValue); const name = validateName(nameValue); const platform = dependencies.platform || process.platform; const env = dependencies.env || process.env; const execFile = dependencies.execFile || defaultExecFile; const fetchImpl = dependencies.fetchImpl || fetch;
  await validateConfiguredRole(configFile, role); const current = await health(configFile, role, fetchImpl); const p = pathsFor(layout, role); const existingPid = await reconcileManagedPid(layout, role, dependencies); if (current.reachable && current.identityMatches) return { started: false, alreadyRunning: true, managed: Boolean(existingPid), name, role, ...(existingPid ? { pid: existingPid } : {}) }; if (current.reachable && !current.identityMatches) throw new Error(`Cannot start ${role} ${name}: configured port is already occupied by another runtime`);
  if (existingPid) await stopManaged(layout, role, dependencies); await secureRuntimeDirectory(p.dir); await secureRuntimeDirectory(layout.logDir);
  const nodePath = path.resolve(dependencies.nodePath || process.execPath); const entryPoint = path.resolve(dependencies.entryPoints?.[role] || packageEntryPoint(role)); let pid: number;
  if (platform === "win32") {
    const ps = windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe", env); const q = (v: string) => `'${v.replaceAll("'", "''")}'`; const command = `$env:QUEQIAO_CONFIG_FILE=${q(path.resolve(configFile))}; $p=Start-Process -FilePath ${q(nodePath)} -ArgumentList @(${q(entryPoint)}) -WorkingDirectory ${q(path.dirname(entryPoint))} -WindowStyle Hidden -PassThru; [Console]::Out.Write($p.Id)`; pid = Number((await execFile(ps, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", command])).stdout.trim());
  } else if (platform === "linux") {
    const stdout = await open(p.stdout, "a", 0o600); const stderr = await open(p.stderr, "a", 0o600); const child = spawn(nodePath, [entryPoint], { cwd: path.dirname(entryPoint), detached: true, stdio: ["ignore", stdout.fd, stderr.fd], env: { ...env, QUEQIAO_CONFIG_FILE: path.resolve(configFile) } }); if (!child.pid) throw new Error(`Queqiao ${role} start did not return a valid PID`); pid = child.pid; child.unref();
  } else throw new Error(`Runtime lifecycle is not supported on platform: ${platform}`);
  if (!Number.isInteger(pid) || pid <= 0) throw new Error(`Queqiao ${role} start did not return a valid PID`); await writeFile(p.pidFile, `${JSON.stringify({ pid, entryPoint, configFile: path.resolve(configFile), startedAt: new Date().toISOString() })}\n`, { encoding: "utf8", mode: 0o600 }); await secureRuntimeFile(p.pidFile); return { started: true, name, role, pid };
}
export async function stopRuntime(layout: RuntimeLayout, roleValue: string, nameValue: string, dependencies: Dependencies = {}) { const role = validateRole(roleValue); const name = validateName(nameValue); return { stopped: await stopManaged(layout, role, dependencies), name, role }; }
export async function runtimeStatus(configFile: string, layout: RuntimeLayout, roleValue: string, nameValue: string, dependencies: Dependencies = {}) { const role = validateRole(roleValue); const name = validateName(nameValue); const pid = await reconcileManagedPid(layout, role, dependencies); const state = await health(configFile, role, dependencies.fetchImpl || fetch); return { name, role, active: state.reachable && state.identityMatches, managed: Boolean(pid), ...(pid ? { pid } : {}), health: state }; }
export async function serveRuntime(configFile: string, roleValue: string, nameValue: string, dependencies: Dependencies = {}) {
  const role = validateRole(roleValue); const name = validateName(nameValue); await validateConfiguredRole(configFile, role); const current = await health(configFile, role, dependencies.fetchImpl || fetch); if (current.reachable && current.identityMatches) throw new Error(`${role} ${name} is already running`); if (current.reachable && !current.identityMatches) throw new Error(`Cannot serve ${role} ${name}: configured port is already occupied by another runtime`); const nodePath = path.resolve(dependencies.nodePath || process.execPath); const entryPoint = path.resolve(dependencies.entryPoints?.[role] || packageEntryPoint(role)); const child = spawn(nodePath, [entryPoint], { cwd: path.dirname(entryPoint), stdio: "inherit", env: { ...(dependencies.env || process.env), QUEQIAO_CONFIG_FILE: path.resolve(configFile) } }); const exitCode = await new Promise<number>((resolve, reject) => { child.once("error", reject); child.once("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0))); }); return { served: true, name, role, exitCode };
}
export const runtimeLifecycleInternals = { validateName, pathsFor, exists };
