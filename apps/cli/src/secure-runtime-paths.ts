import { execFile } from "node:child_process";
import { chmod, mkdir } from "node:fs/promises";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
let currentWindowsSid: Promise<string> | undefined;

async function windowsUserSid(): Promise<string> {
  currentWindowsSid ??= execFileAsync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { windowsHide: true, encoding: "utf8" }).then(({ stdout }) => {
    const sid = stdout.match(/S-\d-(?:\d+-)+\d+/)?.[0];
    if (!sid) throw new Error("Could not resolve the current Windows user SID");
    return sid;
  });
  return currentWindowsSid;
}

async function hardenWindowsAcl(target: string, directory: boolean): Promise<void> {
  const userSid = await windowsUserSid();
  const inheritance = directory ? "(OI)(CI)F" : "F";
  await execFileAsync("icacls.exe", [
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
