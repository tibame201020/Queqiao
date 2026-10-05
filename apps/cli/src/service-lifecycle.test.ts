import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { restartRuntime, runtimeLifecycleInternals, runtimeStatus, serveRuntime, startRuntime, stopRuntime } from "./service-lifecycle.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-runtime-lifecycle-")); const layout = resolveRuntimeLayout({ LOCALAPPDATA: root, TEMP: root, USERPROFILE: root }, "win32"); await import("node:fs/promises").then(({ mkdir }) => mkdir(layout.configDir, { recursive: true }));
  const config = { version: 1, gateway: { publicBaseUrl: "https://example.invalid/shadow/", listen: { host: "127.0.0.1", port: 7675 }, managementListen: { host: "127.0.0.1", port: 7674 }, trustProxyHops: 1, stateDirectory: path.join(root,"state"), approvalSecretFile: path.join(root,"a"), jwtSigningSecretFile: path.join(root,"j") }, workspaces: [], extensions: [] };
  await writeFile(layout.configFile, JSON.stringify(config), "utf8"); return { root, layout };
}

describe("runtime lifecycle", () => {
  it("starts directly without an install step and records the managed PID", async () => {
    const { layout } = await fixture();
    const gateway = "C:\\pkg\\queqiao-gateway.js";
    const processCalls: Array<{ file: string; args: readonly string[] }> = [];
    let started = false;
    let spawnCall: { file: string; args: readonly string[]; options: any } | undefined;
    const execFile = async (file: string, args: readonly string[]) => {
      processCalls.push({ file, args });
      if (file.endsWith("powershell.exe") && args.join(" ").includes("Get-CimInstance") && started) return { stdout: `node.exe ${gateway}`, stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const spawnDetached = (file: string, args: readonly string[], options: any) => {
      started = true;
      spawnCall = { file, args, options };
      return 1234;
    };
    const result = await startRuntime(layout.configFile, layout, "gateway", "shadow", {
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      execFile,
      spawnDetached,
      fetchImpl: async () => started ? new Response("{}", { status: 200 }) : Promise.reject(new Error("offline")),
      sleep: async () => undefined,
      entryPoints: { gateway },
    });
    expect(result).toMatchObject({ started: true, pid: 1234 });
    const pidFile = path.join(layout.stateDir, "processes", "gateway.pid.json");
    expect(JSON.parse(await readFile(pidFile, "utf8"))).toMatchObject({ pid: 1234 });
    expect(spawnCall).toMatchObject({
      file: path.win32.resolve(process.execPath),
      args: [path.win32.resolve(gateway)],
      options: {
        cwd: path.resolve(layout.stateDir),
        stdoutFile: path.join(layout.logDir, "gateway.out.log"),
        stderrFile: path.join(layout.logDir, "gateway.err.log"),
        windowsHide: true,
      },
    });
    expect(spawnCall?.options.env.QUEQIAO_CONFIG_FILE).toBe(path.resolve(layout.configFile));
    expect(spawnCall?.options.env.QUEQIAO_AUDIT_DIR).toBe(path.join(layout.stateDir, "audit"));
    expect(processCalls.some((call) => call.args.join(" ").includes("Get-CimInstance"))).toBe(true);
  });
  it("accepts a reachable Gateway before operational readiness while still verifying PID ownership", async () => {
    const { layout } = await fixture();
    const gateway = "C:\\pkg\\queqiao-gateway.js";
    let started = false;
    const result = await startRuntime(layout.configFile, layout, "gateway", "shadow", {
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      execFile: async (file, args) => file.endsWith("powershell.exe") && args.join(" ").includes("Get-CimInstance") && started
        ? { stdout: `node.exe ${gateway}`, stderr: "" }
        : { stdout: "", stderr: "" },
      spawnDetached: () => { started = true; return 2468; },
      fetchImpl: async () => {
        if (!started) throw new Error("offline");
        return new Response("not-ready", { status: 503 });
      },
      entryPoints: { gateway },
      startupProbeAttempts: 2,
      sleep: async () => undefined,
    });
    expect(result).toMatchObject({ started: true, pid: 2468 });
  });

  it("fails closed when a managed background child never reaches startup acceptance", async () => {
    const { layout } = await fixture();
    const gateway = "C:\\pkg\\queqiao-gateway.js";
    const execFile = async (file: string, args: readonly string[]) => {
      if (file.endsWith("powershell.exe") && args.join(" ").includes("Get-CimInstance")) return { stdout: "", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    await expect(startRuntime(layout.configFile, layout, "gateway", "shadow", {
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      execFile,
      spawnDetached: () => 4321,
      fetchImpl: async () => { throw new Error("offline"); },
      entryPoints: { gateway },
      startupProbeAttempts: 1,
      sleep: async () => undefined,
    })).rejects.toThrow(/failed startup acceptance/i);
    await expect(readFile(path.join(layout.stateDir, "processes", "gateway.pid.json"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("uses the currently installed package entrypoint on a later start instead of stale PID metadata", async () => {
    const { layout } = await fixture();
    const dir = path.join(layout.stateDir, "processes");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    await writeFile(path.join(dir, "gateway.pid.json"), JSON.stringify({ pid: 4321, entryPoint: "C:\\old-global\\dist\\queqiao-gateway.js", configFile: layout.configFile }), "utf8");
    const currentEntryPoint = "C:\\new-global\\dist\\queqiao-gateway.js";
    let started = false;
    let spawnArgs: readonly string[] = [];
    const execFile = async (file: string, args: readonly string[]) => {
      if (file.endsWith("powershell.exe") && args.some((arg) => arg.includes("Get-CimInstance"))) return { stdout: started ? `node.exe ${currentEntryPoint}` : "", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const result = await startRuntime(layout.configFile, layout, "gateway", "shadow", {
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      execFile,
      spawnDetached: (_file, args) => { started = true; spawnArgs = args; return 8765; },
      fetchImpl: async () => { if (!started) throw new Error("offline"); return new Response("{}", { status: 200 }); },
      sleep: async () => undefined,
      entryPoints: { gateway: currentEntryPoint },
    });
    expect(result).toMatchObject({ started: true, pid: 8765 });
    expect(spawnArgs).toEqual([path.win32.resolve(currentEntryPoint)]);
    expect(spawnArgs.join(" ")).not.toContain("old-global");
  });

  it("uses Queqiao state/config directories as daemon working directories instead of the package directory", async () => {
    const { layout } = await fixture();
    expect(runtimeLifecycleInternals.managedWorkingDirectory(layout)).toBe(path.resolve(layout.stateDir));
    expect(runtimeLifecycleInternals.foregroundWorkingDirectory(layout.configFile)).toBe(path.dirname(path.resolve(layout.configFile)));
    expect(runtimeLifecycleInternals.managedWorkingDirectory(layout)).not.toContain("node_modules");
  });
  it("keeps a stopped role stopped on restart and refuses to take over an unmanaged live role", async () => {
    const { layout } = await fixture(); const gateway = "C:\\pkg\\queqiao-gateway.js"; const calls: Array<{ file: string; args: readonly string[] }> = [];
    const execFile = async (file: string, args: readonly string[]) => { calls.push({ file, args }); return file.endsWith("powershell.exe") && args.some((arg) => arg.includes("Start-Process"))
      ? { stdout: "5678", stderr: "" }
      : { stdout: "", stderr: "" }; };
    const started = await restartRuntime(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, fetchImpl: async()=>{ throw new Error("offline"); }, entryPoints: { gateway } });
    expect(started).toMatchObject({ restarted: false, stopped: false, started: false, reason: "stopped", role: "gateway", name: "shadow" });
    expect(calls.flatMap((call) => call.args).some((arg) => arg.includes("Start-Process"))).toBe(false);

    const other = await fixture();
    await expect(restartRuntime(other.layout.configFile, other.layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile: async()=>({stdout:"",stderr:""}), fetchImpl: async()=>new Response("{}",{status:200}), entryPoints: { gateway } })).rejects.toThrow(/active but not managed/);
  });  it("keeps ownership across package relinks by trusting the recorded entrypoint identity", async () => {
    const { layout } = await fixture();
    const dir = path.join(layout.stateDir, "processes");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    const pidFile = path.join(dir, "gateway.pid.json");
    await writeFile(pidFile, JSON.stringify({ pid: 4321, entryPoint: "C:\\repo\\dist\\queqiao-gateway.js", configFile: layout.configFile }), "utf8");
    const execFile = async (file: string) => file.endsWith("powershell.exe") ? { stdout: "node.exe C:\\repo\\dist\\queqiao-gateway.js", stderr: "" } : { stdout: "", stderr: "" };
    const status = await runtimeStatus(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, fetchImpl: async () => new Response("{}", { status: 200 }), entryPoints: { gateway: "C:\\global-link\\dist\\queqiao-gateway.js" } });
    expect(status).toMatchObject({ active: true, managed: true, pid: 4321 });
    expect(JSON.parse(await readFile(pidFile, "utf8"))).toMatchObject({ pid: 4321, entryPoint: "C:\\repo\\dist\\queqiao-gateway.js" });
  });
  it("keeps Linux entrypoint ownership case-sensitive", () => {
    const entryPoint = "/tmp/Queqiao-Acceptance-AbC123/package/queqiao-worker.js";
    expect(runtimeLifecycleInternals.commandOwnsEntryPoint(`node ${entryPoint}`, entryPoint, "linux")).toBe(true);
    expect(runtimeLifecycleInternals.commandOwnsEntryPoint(`node ${entryPoint.toLowerCase()}`, entryPoint, "linux")).toBe(false);
    expect(runtimeLifecycleInternals.commandOwnsEntryPoint("node C:\\PKG\\QUEQIAO-WORKER.JS", "C:\\pkg\\queqiao-worker.js", "win32")).toBe(true);
  });
  it("rejects PID metadata owned by a different named config", async () => {
    const { layout } = await fixture();
    const dir = path.join(layout.stateDir, "processes");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    const pidFile = path.join(dir, "gateway.pid.json");
    await writeFile(pidFile, JSON.stringify({ pid: 4321, entryPoint: "C:\\repo\\dist\\queqiao-gateway.js", configFile: "C:\\other\\config.yaml" }), "utf8");
    const status = await runtimeStatus(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile: async () => ({ stdout: "node.exe C:\\repo\\dist\\queqiao-gateway.js", stderr: "" }), fetchImpl: async () => { throw new Error("offline"); }, entryPoints: { gateway: "C:\\repo\\dist\\queqiao-gateway.js" } });
    expect(status).toMatchObject({ active: false, managed: false });
    await expect(readFile(pidFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });
  it("does not duplicate a reachable unmanaged runtime", async () => { const { layout } = await fixture(); const result = await startRuntime(layout.configFile, layout, "gateway", "shadow", { platform:"win32", env:{SystemRoot:"C:\\Windows"}, execFile: async()=>({stdout:"",stderr:""}), fetchImpl: async()=>new Response("{}",{status:200}), entryPoints:{gateway:"C:\\pkg\\queqiao-gateway.js"} }); expect(result).toMatchObject({started:false,alreadyRunning:true,managed:false}); });
  it("reports health without an installed-service concept", async () => { const { layout } = await fixture(); const status = await runtimeStatus(layout.configFile, layout, "gateway", "shadow", { fetchImpl: async()=>new Response("{}",{status:200}) }); expect(status).toMatchObject({active:true,managed:false,health:{reachable:true,healthy:true,status:200}}); expect(status).not.toHaveProperty("installed"); });
  it("reconciles a stale or reused PID without killing the unrelated process", async () => { const { layout } = await fixture(); const dir=path.join(layout.stateDir,"processes"); await import("node:fs/promises").then(({mkdir})=>mkdir(dir,{recursive:true})); const pidFile=path.join(dir,"gateway.pid.json"); await writeFile(pidFile,JSON.stringify({pid:4321}),"utf8"); const execFile=async(file:string)=>file.endsWith("powershell.exe")?{stdout:"node.exe C:\\other\\server.js",stderr:""}:{stdout:"",stderr:""}; const stopped=await stopRuntime(layout,"gateway","shadow",{platform:"win32",env:{SystemRoot:"C:\\Windows"},execFile,entryPoints:{gateway:"C:\\pkg\\queqiao-gateway.js"}}); expect(stopped).toMatchObject({stopped:false}); await expect(readFile(pidFile,"utf8")).rejects.toMatchObject({code:"ENOENT"}); });
  it("waits for a Windows managed process to exit before reporting stop success", async () => {
    const { layout } = await fixture();
    const dir = path.join(layout.stateDir, "processes");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    const pidFile = path.join(dir, "gateway.pid.json");
    const entryPoint = "C:\\pkg\\queqiao-gateway.js";
    await writeFile(pidFile, JSON.stringify({ pid: 4321, entryPoint, configFile: layout.configFile }), "utf8");
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    let killed = false;
    const execFile = async (file: string, args: readonly string[]) => {
      calls.push({ file, args });
      const command = args.join(" ");
      if (file.endsWith("powershell.exe") && command.includes("Get-CimInstance")) return { stdout: `node.exe ${entryPoint}`, stderr: "" };
      if (file.endsWith("taskkill.exe")) { killed = true; return { stdout: "SUCCESS", stderr: "" }; }
      if (file.endsWith("powershell.exe") && command.includes("Wait-Process")) {
        expect(killed).toBe(true);
        return { stdout: "stopped", stderr: "" };
      }
      return { stdout: "", stderr: "" };
    };

    const stopped = await stopRuntime(layout, "gateway", "shadow", {
      platform: "win32",
      env: { SystemRoot: "C:\\Windows" },
      execFile,
      entryPoints: { gateway: entryPoint },
    });

    expect(stopped).toMatchObject({ stopped: true });
    expect(calls.some((call) => call.file.endsWith("powershell.exe") && call.args.join(" ").includes("Wait-Process"))).toBe(true);
    await expect(readFile(pidFile, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("does not report a dead managed PID after status reconciliation", async () => { const { layout } = await fixture(); const dir=path.join(layout.stateDir,"processes"); await import("node:fs/promises").then(({mkdir})=>mkdir(dir,{recursive:true})); const pidFile=path.join(dir,"gateway.pid.json"); await writeFile(pidFile,JSON.stringify({pid:4321}),"utf8"); const status=await runtimeStatus(layout.configFile,layout,"gateway","shadow",{platform:"win32",env:{SystemRoot:"C:\\Windows"},execFile:async()=>({stdout:"",stderr:""}),fetchImpl:async()=>{throw new Error("offline")},entryPoints:{gateway:"C:\\pkg\\queqiao-gateway.js"}}); expect(status).toMatchObject({active:false,managed:false}); expect(status).not.toHaveProperty("pid"); await expect(readFile(pidFile,"utf8")).rejects.toMatchObject({code:"ENOENT"}); });
  it("keeps a just-started managed PID during transient Windows process discovery lag", async () => { const { layout } = await fixture(); const dir=path.join(layout.stateDir,"processes"); await import("node:fs/promises").then(({mkdir})=>mkdir(dir,{recursive:true})); const pidFile=path.join(dir,"gateway.pid.json"); await writeFile(pidFile,JSON.stringify({pid:4321,entryPoint:"C:\\pkg\\queqiao-gateway.js",configFile:layout.configFile,startedAt:new Date().toISOString()}),"utf8"); const status=await runtimeStatus(layout.configFile,layout,"gateway","shadow",{platform:"win32",env:{SystemRoot:"C:\\Windows"},execFile:async()=>({stdout:"",stderr:""}),fetchImpl:async()=>{throw new Error("offline")},entryPoints:{gateway:"C:\\pkg\\queqiao-gateway.js"}}); expect(status).toMatchObject({active:false,managed:true,pid:4321}); expect(JSON.parse(await readFile(pidFile,"utf8"))).toMatchObject({pid:4321}); });
  it("does not treat a different Worker on the same port as the named Worker", async () => {
    const { root, layout } = await fixture();
    const workerId = "11111111-1111-4111-8111-111111111111";
    await writeFile(path.join(root,"worker.secret"), "w".repeat(43), "utf8");
    await writeFile(layout.configFile, JSON.stringify({ version: 1, worker: { workerId, environmentId: "windows", listen: { host: "127.0.0.1", port: 7576 }, tokenFile: path.join(root,"worker.secret") }, workspaces: [{ id: "one", displayName: "One", root }], extensions: [] }), "utf8");
    const fetchImpl = async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith("/health")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      expect(new Headers(init?.headers).get("x-queqiao-worker-token")).toBe("w".repeat(43));
      return new Response(JSON.stringify({ workerId: "22222222-2222-4222-8222-222222222222", environmentId: "windows" }), { status: 200 });
    };
    const status = await runtimeStatus(layout.configFile, layout, "worker", "windows", { fetchImpl: fetchImpl as typeof fetch });
    expect(status).toMatchObject({ active: false, health: { reachable: true, healthy: false, identityMatches: false, error: "Worker identity does not match this configuration" } });
  });
  it("refuses to serve or background-start when another Worker owns the configured port", async () => {
    const { root, layout } = await fixture();
    const workerId = "11111111-1111-4111-8111-111111111111";
    await writeFile(path.join(root,"worker.secret"), "w".repeat(43), "utf8");
    await writeFile(layout.configFile, JSON.stringify({ version: 1, worker: { workerId, environmentId: "windows", listen: { host: "127.0.0.1", port: 7576 }, tokenFile: path.join(root,"worker.secret") }, workspaces: [{ id: "one", displayName: "One", root }], extensions: [] }), "utf8");
    const fetchImpl = async (input: string | URL | Request) => String(input).endsWith("/health")
      ? new Response(JSON.stringify({ ok: true }), { status: 200 })
      : new Response(JSON.stringify({ workerId: "22222222-2222-4222-8222-222222222222", environmentId: "windows" }), { status: 200 });
    await expect(serveRuntime(layout.configFile, "worker", "windows", { fetchImpl: fetchImpl as typeof fetch })).rejects.toThrow(/port is already occupied by another runtime/);
    await expect(startRuntime(layout.configFile, layout, "worker", "windows", { platform:"win32", env:{SystemRoot:"C:\\Windows"}, execFile: async()=>({stdout:"",stderr:""}), fetchImpl: fetchImpl as typeof fetch, entryPoints:{worker:"C:\\pkg\\queqiao-worker.js"} })).rejects.toThrow(/port is already occupied by another runtime/);
  });
  it("defers a Windows restart when the CLI is running inside the managed runtime process tree", async () => {
    const { layout } = await fixture();
    const dir = path.join(layout.stateDir, "processes");
    await import("node:fs/promises").then(({ mkdir }) => mkdir(dir, { recursive: true }));
    await writeFile(path.join(dir, "gateway.pid.json"), JSON.stringify({ pid: 4321, entryPoint: "C:\\pkg\\queqiao-gateway.js", configFile: layout.configFile }), "utf8");
    const calls: Array<{ file: string; args: readonly string[] }> = [];
    const execFile = async (file: string, args: readonly string[]) => {
      calls.push({ file, args });
      const command = args.join(" ");
      if (command.includes("Invoke-CimMethod")) return { stdout: "0:9876", stderr: "" };
      if (command.includes("$target=4321")) return { stdout: "1", stderr: "" };
      if (command.includes("Get-CimInstance")) return { stdout: "node.exe C:\\pkg\\queqiao-gateway.js", stderr: "" };
      return { stdout: "", stderr: "" };
    };
    const result = await restartRuntime(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, currentPid: 9999, nodePath: "C:\\node.exe", cliEntryPoint: "C:\\pkg\\queqiao.js", execFile, fetchImpl: async () => new Response("{}", { status: 200 }), entryPoints: { gateway: "C:\\pkg\\queqiao-gateway.js" } });
    expect(result).toMatchObject({ restarted: true, stopped: false, started: false, deferred: true, helperPid: 9876, role: "gateway", name: "shadow", pid: 4321 });
    expect(calls.some((call) => call.file.endsWith("taskkill.exe"))).toBe(false);
    const handoff = calls.flatMap((call) => call.args).find((arg) => arg.includes("Invoke-CimMethod"));
    expect(handoff).toBeTruthy();
    const encoded = handoff!.match(/-EncodedCommand ([A-Za-z0-9+/=]+)/)?.[1];
    expect(encoded).toBeTruthy();
    const script = Buffer.from(encoded!, "base64").toString("utf16le");
    expect(script).toContain("taskkill.exe");
    expect(script).toContain("'C:\\pkg\\queqiao.js' 'gateway' 'serve' '--bg' '--gateway' 'shadow'");
  });
  it("rejects unsafe runtime names", async () => { const { layout } = await fixture(); await expect(runtimeStatus(layout.configFile,layout,"gateway","../bad",{fetchImpl:async()=>new Response("{}",{status:200})})).rejects.toThrow(/Name must match/); });
});