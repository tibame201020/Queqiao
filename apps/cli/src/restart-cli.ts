import { execFile as execFileCallback } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { resolveRuntimeLayoutForNamedRole, type RuntimeLayout, type RuntimeRole } from "@queqiao/platform-paths";
import { listRoleInstances, type RoleInstanceInventory } from "./instance-selector.js";
import { restartRuntime } from "./service-lifecycle.js";

type RestartResult = Awaited<ReturnType<typeof restartRuntime>>;
export type ManagedRuntimeTarget = { role: RuntimeRole; name: string; layout: RuntimeLayout };
type ExecFile = (file: string, args: readonly string[]) => Promise<{ stdout: string; stderr: string }>;
type Dependencies = {
  listRoleInstances?: (role: RuntimeRole) => Promise<RoleInstanceInventory[]>;
  resolveLayout?: (role: RuntimeRole, name: string) => RuntimeLayout;
  restartRuntime?: (configFile: string, layout: RuntimeLayout, role: RuntimeRole, name: string) => Promise<RestartResult>;
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  execFile?: ExecFile;
  nodePath?: string;
  cliEntryPoint?: string;
  shouldDeferBatchRestart?: (targets: readonly ManagedRuntimeTarget[]) => boolean;
  scheduleBatchRestart?: (targets: readonly ManagedRuntimeTarget[]) => Promise<number>;
};
const execFileAsync = promisify(execFileCallback);

function defaultExecFile(file: string, args: readonly string[]) {
  return execFileAsync(file, [...args], { encoding: "utf8", windowsHide: true }).then(({ stdout, stderr }) => ({ stdout, stderr }));
}
function windowsSystemExecutable(name: string, env: NodeJS.ProcessEnv) {
  const root = env.SystemRoot || env.WINDIR;
  if (!root) throw new Error("Windows system root is unavailable");
  return path.win32.join(root, "System32", name);
}
function packageCliEntryPoint() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "queqiao.js");
}
function sameConfigFile(left: string, right: string) {
  return path.win32.resolve(left).toLowerCase() === path.win32.resolve(right).toLowerCase();
}
function shouldDeferBatchRestart(targets: readonly ManagedRuntimeTarget[], dependencies: Dependencies = {}) {
  const platform = dependencies.platform || process.platform;
  const env = dependencies.env || process.env;
  const activeConfigFile = env.QUEQIAO_CONFIG_FILE;
  if (platform !== "win32" || !activeConfigFile) return false;
  return targets.some((target) => sameConfigFile(activeConfigFile, target.layout.configFile));
}
function buildWindowsBatchRestartScript(targets: readonly ManagedRuntimeTarget[], dependencies: Dependencies = {}) {
  const nodePath = path.win32.resolve(dependencies.nodePath || process.execPath);
  const cliEntryPoint = path.win32.resolve(dependencies.cliEntryPoint || packageCliEntryPoint());
  const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const commands = targets.map((target) => {
    const selector = `--${target.role}`;
    return `& ${q(nodePath)} ${q(cliEntryPoint)} ${q(target.role)} 'restart' ${q(selector)} ${q(target.name)} '--json' | Out-Null; if($LASTEXITCODE -ne 0){exit $LASTEXITCODE}`;
  });
  return `Start-Sleep -Milliseconds 1000; ${commands.join("; ")}`;
}
async function scheduleWindowsBatchRestart(targets: readonly ManagedRuntimeTarget[], dependencies: Dependencies = {}) {
  const env = dependencies.env || process.env;
  const execFile = dependencies.execFile || defaultExecFile;
  const ps = windowsSystemExecutable("WindowsPowerShell\\v1.0\\powershell.exe", env);
  const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
  const encoded = Buffer.from(buildWindowsBatchRestartScript(targets, dependencies), "utf16le").toString("base64");
  const helperCommand = `"${ps}" -NoLogo -NoProfile -NonInteractive -EncodedCommand ${encoded}`;
  const create = `$r=Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{CommandLine=${q(helperCommand)}}; [Console]::Out.Write(($r.ReturnValue.ToString()+':' + $r.ProcessId.ToString()))`;
  const result = (await execFile(ps, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Command", create])).stdout.trim();
  const [returnValue = Number.NaN, helperPid = Number.NaN] = result.split(":").map(Number);
  if (returnValue !== 0 || !Number.isInteger(helperPid) || helperPid <= 0) throw new Error("Unable to schedule deferred Queqiao restart");
  return helperPid;
}

export async function snapshotManagedRuntimes(dependencies: Dependencies = {}) {
  const list = dependencies.listRoleInstances || listRoleInstances;
  const resolveLayout = dependencies.resolveLayout || ((role: RuntimeRole, name: string) => resolveRuntimeLayoutForNamedRole(role, name));
  const targets: ManagedRuntimeTarget[] = [];
  const skipped: Array<{ role: RuntimeRole; name: string; reason: "stopped" | "unmanaged" }> = [];

  for (const role of ["gateway", "worker"] as const) {
    for (const instance of await list(role)) {
      if (!instance.configured) continue;
      if (!instance.managed) {
        skipped.push({ role, name: instance.name, reason: instance.running ? "unmanaged" : "stopped" });
        continue;
      }
      targets.push({ role, name: instance.name, layout: resolveLayout(role, instance.name) });
    }
  }
  return { targets, skipped };
}

export async function restartManagedRuntimeTargets(targets: readonly ManagedRuntimeTarget[], dependencies: Dependencies = {}) {
  const restart = dependencies.restartRuntime || restartRuntime;
  const restarted: RestartResult[] = [];
  const skipped: Array<{ role: RuntimeRole; name: string; reason: "stopped" }> = [];
  for (const target of targets) {
    const result = await restart(target.layout.configFile, target.layout, target.role, target.name);
    if (result.restarted) restarted.push(result);
    else skipped.push({ role: target.role, name: target.name, reason: "stopped" });
  }
  return { restartedCount: restarted.length, restarted, skipped };
}

export async function restartManagedRuntimes(dependencies: Dependencies = {}) {
  const snapshot = await snapshotManagedRuntimes(dependencies);
  const defer = dependencies.shouldDeferBatchRestart || ((targets: readonly ManagedRuntimeTarget[]) => shouldDeferBatchRestart(targets, dependencies));
  if (snapshot.targets.length && defer(snapshot.targets)) {
    const schedule = dependencies.scheduleBatchRestart || ((targets: readonly ManagedRuntimeTarget[]) => scheduleWindowsBatchRestart(targets, dependencies));
    const helperPid = await schedule(snapshot.targets);
    return {
      restartedCount: snapshot.targets.length,
      restarted: snapshot.targets.map((target) => ({ restarted: true as const, stopped: false as const, started: false as const, deferred: true as const, helperPid, role: target.role, name: target.name })),
      skipped: snapshot.skipped,
    };
  }
  const result = await restartManagedRuntimeTargets(snapshot.targets, dependencies);
  return { ...result, skipped: [...snapshot.skipped, ...result.skipped] };
}

export const restartCliInternals = { sameConfigFile, shouldDeferBatchRestart, buildWindowsBatchRestartScript };
