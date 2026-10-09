import { mkdtemp, rm, symlink, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquireGatewayStateOwner } from "./gateway-state-owner.js";

const tempDirs: string[] = [];
const holders: Array<{ release: () => Promise<void> }> = [];
afterEach(async () => {
  for (const holder of holders.splice(0).reverse()) await holder.release();
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function newDir() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "queqiao-state-owner-"));
  tempDirs.push(dir);
  return dir;
}

describe("single-host Gateway state-directory OS ownership", () => {
  it("acquires the owner before any runtime recovery and holds it through shutdown", async () => {
    const gatewaySource = await readFile(path.join(import.meta.dirname, "index.ts"), "utf8");
    expect(gatewaySource.indexOf("await acquireGatewayStateOwner")).toBeGreaterThan(0);
    expect(gatewaySource.indexOf("await acquireGatewayStateOwner")).toBeLessThan(gatewaySource.indexOf("recoverPending()"));
    expect(gatewaySource).toContain("stateOwner.release()");
  });
  it("denies a second Gateway using the same state directory before either may recover leases", async () => {
    const dir = await newDir();
    const first = await acquireGatewayStateOwner(dir);
    holders.push(first);
    await expect(acquireGatewayStateOwner(dir)).rejects.toThrow(/state.*owned|state.*unavailable/i);
    await expect(acquireGatewayStateOwner(dir)).rejects.toThrow(/state.*owned|state.*unavailable/i);
  });

  it("normalizes filesystem aliases so symlink state directories cannot bypass ownership", async () => {
    const dir = await newDir();
    const alias = dir + "-alias";
    tempDirs.push(alias);
    try {
      await symlink(dir, alias, process.platform === "win32" ? "junction" : "dir");
    } catch (error) {
      if (process.platform === "win32" && (error as NodeJS.ErrnoException).code === "EPERM") return;
      throw error;
    }
    holders.push(await acquireGatewayStateOwner(dir));
    await expect(acquireGatewayStateOwner(alias)).rejects.toThrow(/state.*owned|state.*unavailable/i);
  });

  it("allows a second state directory to operate independently", async () => {
    const a = await acquireGatewayStateOwner(await newDir());
    holders.push(a);
    const b = await acquireGatewayStateOwner(await newDir());
    holders.push(b);
    expect(a.lockPort).not.toEqual(b.lockPort);
  });

  it("releases on graceful shutdown and allows the same directory to restart", async () => {
    const dir = await newDir();
    const first = await acquireGatewayStateOwner(dir);
    await first.release();
    await first.release();
    holders.push(await acquireGatewayStateOwner(dir));
  });

  it("recovers after force-killing an actual separate Node OS process without manual stale-lock deletion", async () => {
    const dir = await newDir();
    const probe = await acquireGatewayStateOwner(dir);
    const port = probe.lockPort;
    await probe.release();
    const script = 'const server=require("node:net").createServer(socket=>socket.destroy());server.listen({host:"127.0.0.1",port:Number(process.argv[1]),exclusive:true},()=>process.stdout.write("BOUND\\n"));';
    const child = spawn(process.execPath, ["-e", script, String(port)], { stdio: ["ignore", "pipe", "pipe"] });
    let exited = false;
    try {
      await new Promise<void>((resolve, reject) => {
        const limit = setTimeout(() => reject(new Error("Child did not bind state owner port")), 5000);
        child.stdout.on("data", (chunk: Buffer) => {
          if (chunk.toString().includes("BOUND")) { clearTimeout(limit); resolve(); }
        });
        child.once("error", reject);
        child.once("exit", () => { if (!exited) reject(new Error("Child exited before ownership accepted")); });
      });
      await expect(acquireGatewayStateOwner(dir)).rejects.toThrow(/state.*owned|state.*unavailable/i);
      child.kill("SIGKILL");
      await new Promise<void>((resolve) => child.once("exit", () => { exited = true; resolve(); }));
      const recovered = await acquireGatewayStateOwner(dir);
      holders.push(recovered);
      expect(recovered.lockPort).toBe(port);
    } finally {
      if (!exited) child.kill("SIGKILL");
    }
  });
});
