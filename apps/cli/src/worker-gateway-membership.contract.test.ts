import crypto from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeConfigSchema, serializeRuntimeConfig, readRuntimeConfig } from "@queqiao/config";
import { joinWorker, encodeJoinCode } from "./enrollment-cli.js";

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const workspace = { id: "default", displayName: "default", root: "C:/workspace", profile: "read-only" as const };

describe("Worker-side Gateway membership persistence contract", () => {
  it("stores Gateway relationships separately from the Worker-local control credential", () => {
    const parsed: any = runtimeConfigSchema.parse({
      version: 1,
      workspaces: [workspace],
      worker: {
        workerId: "11111111-1111-4111-8111-111111111111",
        environmentId: "windows",
        listen: { host: "127.0.0.1", port: 7576 },
        tokenFile: "C:/queqiao/secrets/worker-local-control.secret",
        memberships: [
          {
            gateway: "https://stable.example/",
            credentialRef: { kind: "secret-file", path: "C:/queqiao/secrets/stable-membership.secret" },
            protocols: {
              grpc: { target: "stable.example:7573", caCertificateFile: "C:/queqiao/secrets/stable-grpc.crt" },
            },
          },
          {
            gateway: "https://shadow.example/",
            credentialRef: { kind: "secret-file", path: "C:/queqiao/secrets/shadow-membership.secret" },
            protocols: {},
          },
        ],
      },
    });

    expect(parsed.worker.tokenFile).toContain("worker-local-control.secret");
    expect(parsed.worker.memberships).toHaveLength(2);
    expect(parsed.worker.memberships[0].credentialRef.path).toContain("stable-membership.secret");
    expect(parsed.worker.memberships[1].credentialRef.path).toContain("shadow-membership.secret");
    expect(parsed.worker.memberships[0].credentialRef.path).not.toBe(parsed.worker.tokenFile);
  });

  it("rejects duplicate local relationship records for the same Gateway public URL", () => {
    const base = {
      gateway: "https://stable.example/",
      credentialRef: { kind: "secret-file" as const, path: "C:/queqiao/secrets/a.secret" },
      protocols: {},
    };
    expect(() => runtimeConfigSchema.parse({
      version: 1,
      workspaces: [workspace],
      worker: {
        workerId: "11111111-1111-4111-8111-111111111111",
        environmentId: "windows",
        listen: { host: "127.0.0.1", port: 7576 },
        tokenFile: "C:/queqiao/secrets/worker-local-control.secret",
        memberships: [base, { ...base, credentialRef: { kind: "secret-file", path: "C:/queqiao/secrets/b.secret" } }],
      },
    })).toThrow(/gateway|membership|duplicate|unique/i);
  });

  it("keeps the local control credential unchanged and persists the Gateway-issued membership credential only after join commit", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-membership-credential-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const configFile = path.join(root, "config.yaml");
    const localControlFile = path.join(root, "worker-local.secret");
    const localControl = "l".repeat(48);
    const membershipCredential = "m".repeat(48);
    const workerId = crypto.randomUUID();
    const environmentId = "windows";
    await writeFile(localControlFile, `${localControl}\n`, { mode: 0o600 });
    await writeFile(configFile, serializeRuntimeConfig({
      version: 1,
      workspaces: [{ id: "default", displayName: "default", root: workspaceRoot, profile: "read-only" }],
      worker: { workerId, environmentId, listen: { host: "127.0.0.1", port: 7576 }, tokenFile: localControlFile },
    }), "utf8");

    const joinToken = "j".repeat(43);
    const joinCode = encodeJoinCode({ v: 1, gateway: "https://gateway.example/", token: joinToken });
    const prompted: string[] = [];

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "127.0.0.1" && url.pathname === "/health") return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/identity") {
        expect(new Headers(init?.headers).get("x-queqiao-worker-token")).toBe(localControl);
        return new Response(JSON.stringify({ workerId, environmentId }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols") {
        expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${joinToken}`);
        return new Response(JSON.stringify({ protocols: [{ type: "http", capable: true }] }), { status: 200, headers: { "content-type": "application/json" } });
      }
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/membership/stage") {
        expect(new Headers(init?.headers).get("x-queqiao-worker-token")).toBe(localControl);
        expect(JSON.parse(String(init?.body))).toEqual({ transactionId: "txn-1", gateway: "https://gateway.example/", credential: membershipCredential });
        return new Response(null, { status: 204 });
      }
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/membership/commit") {
        expect(new Headers(init?.headers).get("x-queqiao-worker-token")).toBe(localControl);
        expect(JSON.parse(String(init?.body))).toEqual({ transactionId: "txn-1" });
        return new Response(null, { status: 204 });
      }
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/join/start") return new Response(JSON.stringify({ transactionId: "txn-1", credential: membershipCredential }), { status: 201, headers: { "content-type": "application/json" } });
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/join/confirm") {
        expect(new Headers(init?.headers).get("x-queqiao-worker-token")).toBe(membershipCredential);
        return new Response(JSON.stringify({ joined: true, workerId, environmentId }), { status: 200, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${url.href}`);
    });

    const result: any = await joinWorker(configFile, ["worker", "join"], async (field) => {
      prompted.push(field);
      if (field === "code") return joinCode;
      if (field === "protocols") return "http";
      throw new Error(`Unexpected prompt field: ${field}`);
    });

    expect(result).toMatchObject({ joined: true, workerId, environmentId });
    expect((await readFile(localControlFile, "utf8")).trim()).toBe(localControl);
    const runtime: any = await readRuntimeConfig(configFile);
    expect(runtime.worker.memberships).toHaveLength(1);
    expect(runtime.worker.memberships[0].gateway).toBe("https://gateway.example/");
    const credentialPath = runtime.worker.memberships[0].credentialRef.path;
    expect(path.resolve(credentialPath)).not.toBe(path.resolve(localControlFile));
    expect((await readFile(credentialPath, "utf8")).trim()).toBe(membershipCredential);
    expect(prompted).toEqual(["code", "protocols"]);
  });

  it("does not leave a durable Gateway membership credential or relationship when join confirmation fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-worker-membership-rollback-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot, { recursive: true });
    const configFile = path.join(root, "config.yaml");
    const localControlFile = path.join(root, "worker-local.secret");
    const localControl = "l".repeat(48);
    const membershipCredential = "m".repeat(48);
    const workerId = crypto.randomUUID();
    const environmentId = "windows";
    await writeFile(localControlFile, `${localControl}\n`, { mode: 0o600 });
    await writeFile(configFile, serializeRuntimeConfig({
      version: 1,
      workspaces: [{ id: "default", displayName: "default", root: workspaceRoot, profile: "read-only" }],
      worker: { workerId, environmentId, listen: { host: "127.0.0.1", port: 7576 }, tokenFile: localControlFile },
    }), "utf8");

    const joinToken = "j".repeat(43);
    const joinCode = encodeJoinCode({ v: 1, gateway: "https://gateway.example/", token: joinToken });
    let confirmationReached = false;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (url.hostname === "127.0.0.1" && url.pathname === "/health") return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/identity") return new Response(JSON.stringify({ workerId, environmentId }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/protocols") return new Response(JSON.stringify({ protocols: [{ type: "http", capable: true }] }), { status: 200, headers: { "content-type": "application/json" } });
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/membership/stage") return new Response(null, { status: 204 });
      if (url.hostname === "127.0.0.1" && url.pathname === "/enrollment/membership/revoke") {
        expect(JSON.parse(String(init?.body))).toEqual({ transactionId: "txn-1" });
        return new Response(null, { status: 204 });
      }
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/join/start") return new Response(JSON.stringify({ transactionId: "txn-1", credential: membershipCredential }), { status: 201, headers: { "content-type": "application/json" } });
      if (url.hostname === "gateway.example" && url.pathname === "/enrollment/join/confirm") {
        confirmationReached = true;
        return new Response(JSON.stringify({ error: "join_confirmation_failed" }), { status: 502, headers: { "content-type": "application/json" } });
      }
      throw new Error(`Unexpected fetch ${url.href}: ${String(init?.method || "GET")}`);
    });

    await expect(joinWorker(configFile, ["worker", "join"], async (field) => field === "code" ? joinCode : "http")).rejects.toThrow();
    expect(confirmationReached).toBe(true);
    expect((await readFile(localControlFile, "utf8")).trim()).toBe(localControl);
    const runtime: any = await readRuntimeConfig(configFile);
    expect(runtime.worker.memberships ?? []).toEqual([]);
    const files = await readdir(root, { recursive: true });
    expect(files.some((entry) => String(entry).includes("membership") && String(entry).endsWith(".secret"))).toBe(false);
  });
});
