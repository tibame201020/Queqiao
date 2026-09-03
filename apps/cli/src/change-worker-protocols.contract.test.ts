import crypto from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { readRuntimeConfig, serializeRuntimeConfig } from "@queqiao/config";
import { changeWorkerMembershipProtocols } from "./enrollment-cli.js";

const roots: string[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-change-protocols-")); roots.push(root);
  const workspaceRoot = path.join(root, "workspace"); await mkdir(workspaceRoot, { recursive: true });
  const configFile = path.join(root, "config.yaml");
  const localFile = path.join(root, "local.secret");
  const membershipFile = path.join(root, "membership.secret");
  const local = "l".repeat(48); const membership = "m".repeat(48); const workerId = crypto.randomUUID();
  await writeFile(localFile, `${local}\n`, { mode: 0o600 }); await writeFile(membershipFile, `${membership}\n`, { mode: 0o600 });
  await writeFile(configFile, serializeRuntimeConfig({
    version: 1,
    workspaces: [{ id: "default", displayName: "default", root: workspaceRoot, profile: "read-only" }],
    worker: { workerId, environmentId: "windows", listen: { host: "127.0.0.1", port: 7576 }, tokenFile: localFile, memberships: [{ gateway: "https://gateway.example/", credentialRef: { kind: "secret-file", path: membershipFile }, protocols: {} }] },
  }), "utf8");
  return { root, configFile, workerId, local, membership };
}

describe("Worker protocol reconfiguration transaction", () => {
  it("prepares newly enabled gRPC before Gateway commit and persists local state after commit", async () => {
    const f = await fixture(); const order: string[] = [];
    const ca = `-----BEGIN CERTIFICATE-----\n${"A".repeat(96)}\n-----END CERTIFICATE-----\n`;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols" && (init?.method || "GET") === "GET") return new Response(JSON.stringify({ enabled: ["http"], protocols: [{ type: "http", capable: true }, { type: "grpc", capable: true, connection: { target: "gateway.example:7573", security: "tls", caCertificate: ca } }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/reverse-session/connect") { order.push("prepare"); expect(new Headers(init?.headers).get("x-queqiao-worker-token")).toBe(f.local); return new Response(null, { status: 204 }); }
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols" && init?.method === "PUT") { order.push("gateway-commit"); expect(new Headers(init.headers).get("x-queqiao-worker-token")).toBe(f.membership); return new Response(JSON.stringify({ updated: true, enabled: ["http", "grpc"] }), { status: 200, headers: { "content-type": "application/json" } }); }
      throw new Error(`Unexpected fetch: ${url.href} ${String(init?.method || "GET")}`);
    });
    await changeWorkerMembershipProtocols(f.configFile, "https://gateway.example/", ["http", "grpc"]);
    order.push("local-persisted");
    expect(order).toEqual(["prepare", "gateway-commit", "local-persisted"]);
    const runtime: any = await readRuntimeConfig(f.configFile);
    expect(runtime.worker.memberships[0].protocols.grpc).toMatchObject({ target: "gateway.example:7573", security: "tls" });
    expect(await readFile(runtime.worker.memberships[0].protocols.grpc.caCertificateFile, "utf8")).toBe(ca);
  });

  it("rolls back a newly prepared gRPC session when Gateway commit fails", async () => {
    const f = await fixture(); const order: string[] = [];
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols" && (init?.method || "GET") === "GET") return new Response(JSON.stringify({ enabled: ["http"], protocols: [{ type: "http", capable: true }, { type: "grpc", capable: true, connection: { target: "127.0.0.1:7573", security: "loopback" } }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/reverse-session/connect") { order.push("prepare"); return new Response(null, { status: 204 }); }
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols" && init?.method === "PUT") { order.push("gateway-fail"); return new Response(JSON.stringify({ error: "worker_session_unavailable" }), { status: 502, headers: { "content-type": "application/json" } }); }
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/reverse-session/disconnect") { order.push("rollback"); return new Response(null, { status: 204 }); }
      throw new Error(`Unexpected fetch: ${url.href}`);
    });
    await expect(changeWorkerMembershipProtocols(f.configFile, "https://gateway.example/", ["http", "grpc"])).rejects.toThrow(/worker_session_unavailable/);
    expect(order).toEqual(["prepare", "gateway-fail", "rollback"]);
    const runtime: any = await readRuntimeConfig(f.configFile);
    expect(runtime.worker.memberships[0].protocols.grpc).toBeUndefined();
  });

  it("tears down removed gRPC only after Gateway commit succeeds", async () => {
    const f = await fixture(); const order: string[] = [];
    const runtime: any = await readRuntimeConfig(f.configFile);
    const caFile = path.join(f.root, "existing.crt"); await writeFile(caFile, "certificate", "utf8");
    runtime.worker.memberships[0].protocols = { grpc: { target: "gateway.example:7573", security: "tls", caCertificateFile: caFile } };
    await writeFile(f.configFile, serializeRuntimeConfig(runtime), "utf8");
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols" && (init?.method || "GET") === "GET") return new Response(JSON.stringify({ enabled: ["http", "grpc"], protocols: [{ type: "http", capable: true }, { type: "grpc", capable: true, connection: { target: "gateway.example:7573", security: "tls", caCertificate: "ignored" } }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols" && init?.method === "PUT") { order.push("gateway-commit"); return new Response(JSON.stringify({ updated: true, enabled: ["http"] }), { status: 200, headers: { "content-type": "application/json" } }); }
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/reverse-session/disconnect") { order.push("teardown"); return new Response(null, { status: 204 }); }
      throw new Error(`Unexpected fetch: ${url.href}`);
    });
    await changeWorkerMembershipProtocols(f.configFile, "https://gateway.example/", ["http"]);
    expect(order).toEqual(["gateway-commit", "teardown"]);
    expect((await readRuntimeConfig(f.configFile) as any).worker.memberships[0].protocols.grpc).toBeUndefined();
  });
});
