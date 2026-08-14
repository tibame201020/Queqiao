import os from "node:os";
import path, { win32 as windowsPath } from "node:path";
import { execFile } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import { promisify } from "node:util";

export type RuntimeLayout = {
  configDir: string;
  dataDir: string;
  stateDir: string;
  logDir: string;
  runtimeDir: string;
  secretsDir: string;
  configFile: string;
  gatewayStateDir: string;
};

export function resolveRuntimeLayout(env: NodeJS.ProcessEnv = process.env, platform: NodeJS.Platform = process.platform): RuntimeLayout {
  const paths = platform === "win32" ? path.win32 : path.posix;
  const windows = platform === "win32";
  const home = (windows ? env.USERPROFILE || env.HOME : env.HOME || env.USERPROFILE) || os.homedir();
  const localAppData = env.LOCALAPPDATA || paths.join(home, "AppData", "Local");
  const configDir = paths.resolve(env.QUEQIAO_CONFIG_DIR || (windows ? paths.join(localAppData, "Queqiao", "config") : paths.join(env.XDG_CONFIG_HOME || paths.join(home, ".config"), "queqiao")));
  const dataDir = paths.resolve(env.QUEQIAO_DATA_DIR || (windows ? paths.join(localAppData, "Queqiao", "data") : paths.join(env.XDG_DATA_HOME || paths.join(home, ".local", "share"), "queqiao")));
  const stateDir = paths.resolve(env.QUEQIAO_STATE_HOME || (windows ? paths.join(localAppData, "Queqiao", "state") : paths.join(env.XDG_STATE_HOME || paths.join(home, ".local", "state"), "queqiao")));
  const runtimeDir = paths.resolve(env.QUEQIAO_RUNTIME_DIR || (windows ? paths.join(env.TEMP || os.tmpdir(), "Queqiao") : paths.join(env.XDG_RUNTIME_DIR || os.tmpdir(), `queqiao-${typeof process.getuid === "function" ? process.getuid() : "user"}`)));
  return {
    configDir,
    dataDir,
    stateDir,
    runtimeDir,
    logDir: paths.join(stateDir, "logs"),
    secretsDir: paths.join(dataDir, "secrets"),
    configFile: paths.join(configDir, "config.yaml"),
    gatewayStateDir: paths.join(dataDir, "gateway"),
  };
}

const execFileAsync = promisify(execFile);
let currentWindowsSid: Promise<string> | undefined;

function windowsSystemExecutable(name: string): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) throw new Error("Windows system root is unavailable");
  return windowsPath.join(systemRoot, "System32", name);
}

async function windowsUserSid(): Promise<string> {
  currentWindowsSid ??= execFileAsync(windowsSystemExecutable("whoami.exe"), ["/user", "/fo", "csv", "/nh"], { windowsHide: true, encoding: "utf8" }).then(({ stdout }) => {
    const sid = stdout.match(/S-\d-(?:\d+-)+\d+/)?.[0];
    if (!sid) throw new Error("Could not resolve the current Windows user SID");
    return sid;
  });
  return currentWindowsSid;
}

async function hardenWindowsAcl(target: string, directory: boolean): Promise<void> {
  const userSid = await windowsUserSid();
  const inheritance = directory ? "(OI)(CI)F" : "F";
  await execFileAsync(windowsSystemExecutable("icacls.exe"), [
    target,
    "/inheritance:r",
    "/grant:r",
    `*${userSid}:${inheritance}`,
    `*S-1-5-18:${inheritance}`,
  ], { windowsHide: true, encoding: "utf8" });
}

/** Create a private Queqiao runtime directory. Windows ACL hardening is fail-closed. */
export async function secureRuntimeDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await chmod(directory, 0o700).catch((error) => {
    if (process.platform !== "win32") throw error;
  });
  if (process.platform === "win32") await hardenWindowsAcl(directory, true);
}

/** Harden a Queqiao runtime/config/secret file after creation. */
export async function secureRuntimeFile(file: string): Promise<void> {
  await chmod(file, 0o600).catch((error) => {
    if (process.platform !== "win32") throw error;
  });
  if (process.platform === "win32") await hardenWindowsAcl(file, false);
}
