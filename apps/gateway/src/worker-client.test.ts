import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerClient } from "./worker-client.js";
import { QUEQIAO_WORKER_LEGACY_CAPABILITIES, QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";

const legacyConfig = { environmentId: "windows", url: new URL("http://worker.local"), token: "secret" };
const membershipConfig = {
  workerId: "11111111-1111-4111-8111-111111111111",
  environmentId: "windows",
  transport: { type: "http" as const, endpoint: "http://127.0.0.1:7576" },
  token: "secret",
};
const readResult = { path: "a.txt", startLine: 1, endLine: 1, totalLines: 1, text: "ok" };
const legacyHello = { protocolVersion: QUEQIAO_WORKER_LEGACY_PROTOCOL_VERSION, environmentId: "windows", instanceId: "11111111-1111-4111-8111-111111111111", platform: "windows", capabilities: [...QUEQIAO_WORKER_LEGACY_CAPABILITIES] };
const membershipHello = { protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, workerId: membershipConfig.workerId, environmentId: "windows", instanceId: "22222222-2222-4222-8222-222222222222", platform: "windows", capabilities: [] };

afterEach(() => vi.unstubAllGlobals());

describe("WorkerClient rolling upgrade", () => {
  it("falls back to the legacy read route only when the invocation route is absent", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(legacyHello), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "tool_not_found" }), { status: 404, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(readResult), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(legacyConfig).readFile({ workspaceId: "one", path: "a.txt", offset: 0, limit: 1 })).resolves.toEqual(readResult);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[2]?.[0])).toContain("/v1/read-file");
  });

  it("does not bypass a policy denial through the legacy route", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(legacyHello), { status: 200, headers: { "content-type": "application/json" } })).mockResolvedValue(new Response(JSON.stringify({ error: "tool_denied", message: "read_file is denied" }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(legacyConfig).readFile({ workspaceId: "one", path: "a.txt", offset: 0, limit: 1 })).rejects.toMatchObject({ code: "tool_denied", layer: "worker", retryable: false, message: "read_file is denied" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("keeps mandatory capability checks only for legacy 2.0 Workers", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...legacyHello, capabilities: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(legacyConfig).listWorkspaces()).rejects.toThrow(/capability missing/);
  });

  it("accepts 3.0 membership Workers with no optional capabilities", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(membershipHello), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ environmentId: "windows", defaultWorkspaceId: "one", workspaces: [] }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(membershipConfig).listWorkspaces()).resolves.toMatchObject({ environmentId: "windows" });
  });

  it("fails closed when membership routing reaches legacy 2.0 or the wrong stable workerId", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(legacyHello), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(new WorkerClient(membershipConfig).listWorkspaces()).rejects.toThrow(/Protocol 3.0/);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...membershipHello, workerId: "33333333-3333-4333-8333-333333333333" }), { status: 200, headers: { "content-type": "application/json" } })));
    await expect(new WorkerClient(membershipConfig).listWorkspaces()).rejects.toThrow(/stable identity mismatch/);
  });

  it("validates async process results after membership handshake", async () => {
    const asyncResult = { pid: 4321, startedAt: "2026-08-13T01:00:00.000Z", timeoutMs: 1000, stdout: "discarded", stderr: "discarded" };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(membershipHello), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: asyncResult }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(membershipConfig).run({ workspaceId: "one", executable: "node", args: [], cwd: ".", timeoutMs: 1000, mode: "async" })).resolves.toEqual(asyncResult);
  });
});
