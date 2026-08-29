import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { runtimeStatus, serveRuntime, startRuntime, stopRuntime } from "./service-lifecycle.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-runtime-lifecycle-")); const layout = resolveRuntimeLayout({ LOCALAPPDATA: root, TEMP: root, USERPROFILE: root }, "win32"); await import("node:fs/promises").then(({ mkdir }) => mkdir(layout.configDir, { recursive: true }));
  const config = { version: 1, gateway: { publicBaseUrl: "https://example.invalid/shadow/", listen: { host: "127.0.0.1", port: 7675 }, managementListen: { host: "127.0.0.1", port: 7674 }, trustProxyHops: 1, stateDirectory: path.join(root,"state"), approvalSecretFile: path.join(root,"a"), jwtSigningSecretFile: path.join(root,"j") }, workspaces: [], extensions: [] };
  await writeFile(layout.configFile, JSON.stringify(config), "utf8"); return { root, layout };
}

describe("runtime lifecycle", () => {
  it("starts directly without an install step and records the managed PID", async () => {
    const { layout } = await fixture(); const gateway = "C:\\pkg\\queqiao-gateway.js"; const calls: any[] = [];
    const execFile = async (file: string, args: readonly string[]) => { calls.push({file,args}); if (file.endsWith("powershell.exe") && args.some(a=>a.includes("Start-Process"))) return { stdout: "1234", stderr: "" }; return { stdout: "", stderr: "" }; };
    const result = await startRuntime(layout.configFile, layout, "gateway", "shadow", { platform: "win32", env: { SystemRoot: "C:\\Windows" }, execFile, fetchImpl: async()=>{ throw new Error("offline"); }, entryPoints: { gateway } });
    expect(result).toMatchObject({ started: true, pid: 1234 }); const pidFile = path.join(layout.stateDir,"processes","gateway.pid.json"); expect(JSON.parse(await readFile(pidFile,"utf8"))).toMatchObject({pid:1234});
  });
  it("keeps ownership across package relinks by trusting the recorded entrypoint identity", async () => {
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
  it("does not report a dead managed PID after status reconciliation", async () => { const { layout } = await fixture(); const dir=path.join(layout.stateDir,"processes"); await import("node:fs/promises").then(({mkdir})=>mkdir(dir,{recursive:true})); const pidFile=path.join(dir,"gateway.pid.json"); await writeFile(pidFile,JSON.stringify({pid:4321}),"utf8"); const status=await runtimeStatus(layout.configFile,layout,"gateway","shadow",{platform:"win32",env:{SystemRoot:"C:\\Windows"},execFile:async()=>({stdout:"",stderr:""}),fetchImpl:async()=>{throw new Error("offline")},entryPoints:{gateway:"C:\\pkg\\queqiao-gateway.js"}}); expect(status).toMatchObject({active:false,managed:false}); expect(status).not.toHaveProperty("pid"); await expect(readFile(pidFile,"utf8")).rejects.toMatchObject({code:"ENOENT"}); });
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
  it("rejects unsafe runtime names", async () => { const { layout } = await fixture(); await expect(runtimeStatus(layout.configFile,layout,"gateway","../bad",{fetchImpl:async()=>new Response("{}",{status:200})})).rejects.toThrow(/Name must match/); });
});
