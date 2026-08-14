import { execFileSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { secureRuntimeDirectory, secureRuntimeFile } from "./secure-runtime-paths.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

function currentSid(): string {
  const output = execFileSync("whoami.exe", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
  const sid = output.match(/S-\d-(?:\d+-)+\d+/)?.[0];
  if (!sid) throw new Error("Could not resolve test user SID");
  return sid;
}

function aclState(target: string): { protected: boolean; sids: string[]; inherited: boolean[] } {
  const script = [
    "$acl=Get-Acl -LiteralPath $env:QUEQIAO_ACL_TARGET",
    "$rules=@($acl.Access | ForEach-Object { [pscustomobject]@{ sid=$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value; inherited=$_.IsInherited } })",
    "[pscustomobject]@{ protected=$acl.AreAccessRulesProtected; rules=$rules } | ConvertTo-Json -Compress -Depth 4",
  ].join("; ");
  const parsed = JSON.parse(execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
    env: { ...process.env, QUEQIAO_ACL_TARGET: target },
  })) as { protected: boolean; rules: Array<{ sid: string; inherited: boolean }> | { sid: string; inherited: boolean } };
  const rules = Array.isArray(parsed.rules) ? parsed.rules : [parsed.rules];
  return { protected: parsed.protected, sids: rules.map((rule) => rule.sid).sort(), inherited: rules.map((rule) => rule.inherited) };
}

describe.skipIf(process.platform !== "win32")("Windows runtime ACL hardening", () => {
  it("removes inherited broad access and keeps only the current user plus SYSTEM", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-acl-security-"));
    execFileSync("icacls.exe", [temporary, "/grant", "*S-1-1-0:(OI)(CI)M"], { windowsHide: true, stdio: "ignore" });

    const directory = path.join(temporary, "private");
    await secureRuntimeDirectory(directory);
    const file = path.join(directory, "secret.txt");
    await writeFile(file, "secret", { mode: 0o600 });
    await secureRuntimeFile(file);

    const expected = ["S-1-5-18", currentSid()].sort();
    for (const target of [directory, file]) {
      const state = aclState(target);
      expect(state.protected).toBe(true);
      expect(state.sids).toEqual(expected);
      expect(state.inherited.every((value) => value === false)).toBe(true);
    }
  });
});
