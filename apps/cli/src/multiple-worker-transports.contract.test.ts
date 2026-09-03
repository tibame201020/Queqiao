import crypto from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Server } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeRuntimeConfig } from "@queqiao/config";
import { createWorkerApp } from "../../worker/src/app.js";
import { WorkerCredentialSource } from "../../worker/src/worker-credential-source.js";
import { createJoinToken, decodeJoinCode, encodeJoinCode, joinWorker, setupGateway } from "./enrollment-cli.js";

const servers: Server[] = [];
const roots: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function listen(app: any): Promise<{ server: Server; url: string }> {
  const server = await new Promise<Server>((resolve) => {
    const current = app.listen(0, "127.0.0.1", () => resolve(current));
  });
  servers.push(server);
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not listen");
  return { server, url: `http://127.0.0.1:${address.port}/` };
}

async function workerFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-multi-protocol-join-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  const tokenFile = path.join(root, "worker.secret");
  await writeFile(tokenFile, `${"b".repeat(48)}\n`, { mode: 0o600 });
  const workerId = crypto.randomUUID();
  const environmentId = "windows";
  const credential = new WorkerCredentialSource(tokenFile);
  const workerApp = await createWorkerApp({
    workerId,
    environmentId,
    workerCredential: credential,
    workspaces: [{ id: "default", displayName: "default", root: workspaceRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
  });
  const worker = await listen(workerApp);
  const configFile = path.join(root, "config.yaml");
  await writeFile(configFile, serializeRuntimeConfig({
    version: 1,
    workspaces: [{ id: "default", displayName: "default", root: workspaceRoot, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } }],
    worker: { workerId, environmentId, listen: { host: "127.0.0.1", port: Number(new URL(worker.url).port) }, tokenFile },
  }), "utf8");
  return { configFile, workerId, environmentId, tokenFile };
}

describe("worker join protocol selection contract", () => {
  it("keeps qjq1 limited to bootstrap URL, token, and optional expiry", () => {
    const code = encodeJoinCode({ v: 1, gateway: "https://gateway.example/", token: "t".repeat(43), expiresAt: "2026-09-02T10:00:00.000Z" });
    const decoded: any = decodeJoinCode(code);
    expect(decoded).toEqual({ v: 1, gateway: "https://gateway.example/", token: "t".repeat(43), expiresAt: "2026-09-02T10:00:00.000Z" });
    expect(decoded).not.toHaveProperty("workerSession");
    expect(decoded).not.toHaveProperty("protocols");
  });

  it("does not embed protocol connection metadata in a generated join code even when Gateway gRPC is configured", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-slim-join-code-"));
    roots.push(root);
    const configFile = path.join(root, "config", "config.yaml");
    await setupGateway(configFile, ["gateway", "setup", "--public-base-url", "https://gateway.example/", "--worker-session-mode", "remote", "--worker-session-host", "gateway.local", "--worker-session-port", "8073"], path.join(root, "state"), path.join(root, "secrets"));
    let copied = "";
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ token: "t".repeat(43), expiresAt: "2026-09-02T10:00:00.000Z", bindings: {} }), { status: 201, headers: { "content-type": "application/json" } }));
    try {
      await createJoinToken(configFile, ["gateway", "join-token"], async (value) => { copied = value; });
    } finally {
      fetchSpy.mockRestore();
    }
    const decoded: any = decodeJoinCode(copied);
    expect(decoded).toEqual({ v: 1, gateway: "https://gateway.example/", token: "t".repeat(43), expiresAt: "2026-09-02T10:00:00.000Z" });
    expect(decoded).not.toHaveProperty("workerSession");
  });
  it("discovers current Gateway protocols with the join token before asking for the allowed protocol set", async () => {
    const f = await workerFixture();
    const joinToken = "t".repeat(43);
    const joinCode = encodeJoinCode({ v: 1, gateway: "https://gateway.example/", token: joinToken });
    const prompted: string[] = [];
    const order: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "127.0.0.1" && url.pathname === "/health") return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/identity") return new Response(JSON.stringify({ workerId: f.workerId, environmentId: f.environmentId }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols") {
        order.push("discover");
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${joinToken}`);
        return new Response(JSON.stringify({ protocols: [
          { type: "http", available: true },
          { type: "grpc", available: true, connection: { target: "gateway.local:7573", caCertificate: "-----BEGIN CERTIFICATE-----\nTEST\n-----END CERTIFICATE-----\n" } },
        ] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/join/start") throw new Error("stop-after-selection");
      throw new Error(`Unexpected fetch ${url.href}: ${String(init?.method || "GET")}`);
    });

    await expect(joinWorker(f.configFile, ["worker", "join"], async (field) => {
      prompted.push(field);
      if (field === "code") { order.push("code"); return joinCode; }
      if (field === "protocols") { order.push("protocols"); return "http,grpc"; }
      throw new Error(`Unexpected prompt field: ${field}`);
    })).rejects.toThrow(/stop-after-selection|Unexpected prompt field/);

    expect(prompted).toEqual(["code", "protocols"]);
    expect(order).toEqual(["code", "discover", "protocols"]);
    expect((await readFile(f.tokenFile, "utf8")).trim()).toBe("b".repeat(48));
  });
});
