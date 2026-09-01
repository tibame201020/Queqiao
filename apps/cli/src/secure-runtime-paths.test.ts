import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { secureRuntimeDirectory, secureRuntimeFile } from "./secure-runtime-paths.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

function windowsSystemExecutable(name: string): string {
  const systemRoot = process.env.SystemRoot || process.env.WINDIR;
  if (!systemRoot) throw new Error("Windows system root is unavailable");
  return path.win32.join(systemRoot, "System32", name);
}

type AclState = { protected: boolean; sids: string[]; inherited: boolean[] };
function aclSnapshot(targets: string[]): { currentSid: string; states: AclState[] } {
  const script = [
    "$paths=ConvertFrom-Json $env:QUEQIAO_ACL_TARGETS",
    "$currentSid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value",
    "$states=@($paths | ForEach-Object { $p=$_; $acl=if([System.IO.Directory]::Exists($p)){[System.IO.Directory]::GetAccessControl($p)}else{[System.IO.File]::GetAccessControl($p)}; $rules=@($acl.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]) | ForEach-Object { [pscustomobject]@{ sid=$_.IdentityReference.Value; inherited=[bool]$_.IsInherited } }); [pscustomobject]@{ protected=[bool]$acl.AreAccessRulesProtected; rules=$rules } })",
    "[pscustomobject]@{ currentSid=$currentSid; states=$states } | ConvertTo-Json -Compress -Depth 5",
  ].join("; ");
  const output = execFileSync(path.win32.join(process.env.SystemRoot || process.env.WINDIR || "", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, QUEQIAO_ACL_TARGETS: JSON.stringify(targets) },
  });
  const parsed = JSON.parse(output) as { currentSid: string; states: Array<{ protected: boolean; rules: Array<{ sid: string; inherited: boolean }> | { sid: string; inherited: boolean } }> };
  return {
    currentSid: parsed.currentSid,
    states: parsed.states.map((state) => {
      const rules = Array.isArray(state.rules) ? state.rules : [state.rules];
      return { protected: state.protected, sids: rules.map((rule) => rule.sid).sort(), inherited: rules.map((rule) => rule.inherited) };
    }),
  };
}

describe.skipIf(process.platform !== "win32")("Windows runtime ACL hardening", () => {
  it("removes inherited broad access and keeps only the current user plus SYSTEM", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-acl-security-"));
    execFileSync(windowsSystemExecutable("icacls.exe"), [temporary, "/grant", "*S-1-1-0:(OI)(CI)M"], { windowsHide: true, stdio: "ignore" });

    const directory = path.join(temporary, "private");
    await secureRuntimeDirectory(directory);
    const file = path.join(directory, "secret.txt");
    await writeFile(file, "secret", { mode: 0o600 });
    await secureRuntimeFile(file);

    const { currentSid, states } = aclSnapshot([directory, file]);
    const expected = ["S-1-5-18", currentSid].sort();
    for (const state of states) {
      expect(state.protected).toBe(true);
      expect(state.sids).toEqual(expected);
      expect(state.inherited.every((value) => value === false)).toBe(true);
    }
  }, 30_000);
});
