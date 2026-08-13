import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerClient } from "./worker-client.js";
import { QUEQIAO_WORKER_CAPABILITIES, QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";

const config = { environmentId: "windows", url: new URL("http://worker.local"), token: "secret" };
const readResult = { path: "a.txt", startLine: 1, endLine: 1, totalLines: 1, text: "ok" };
const hello = { protocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION, environmentId: "windows", instanceId: "11111111-1111-4111-8111-111111111111", platform: "windows", capabilities: [...QUEQIAO_WORKER_CAPABILITIES] };

afterEach(() => vi.unstubAllGlobals());

describe("WorkerClient rolling upgrade", () => {
  it("falls back to the legacy read route only when the invocation route is absent", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(hello), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "tool_not_found" }), { status: 404, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(readResult), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).readFile({ workspaceId: "one", path: "a.txt", offset: 0, limit: 1 })).resolves.toEqual(readResult);
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(String(fetch.mock.calls[2]?.[0])).toContain("/v1/read-file");
  });

  it("does not bypass a policy denial through the legacy route", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(hello), { status: 200, headers: { "content-type": "application/json" } })).mockResolvedValue(new Response(JSON.stringify({ error: "tool_denied", message: "read_file is denied" }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).readFile({ workspaceId: "one", path: "a.txt", offset: 0, limit: 1 })).rejects.toMatchObject({ code: "tool_denied", layer: "worker", retryable: false, message: "read_file is denied" });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("fails closed before workspace access when the Worker protocol is incompatible", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...hello, protocolVersion: "1.0" }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).listWorkspaces()).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("validates Worker 2.0 async process results and rejects malformed mode-dependent results", async () => {
    const asyncResult = { pid: 4321, startedAt: "2026-08-13T01:00:00.000Z", timeoutMs: 1000, stdout: "discarded", stderr: "discarded" };
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(hello), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: asyncResult }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).run({ workspaceId: "one", executable: "node", args: [], cwd: ".", timeoutMs: 1000, mode: "async" })).resolves.toEqual(asyncResult);

    const malformedFetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(hello), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ result: { pid: 1, stdout: "captured", stderr: "discarded" } }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", malformedFetch);
    await expect(new WorkerClient(config).run({ workspaceId: "one", executable: "node", args: [], cwd: ".", timeoutMs: 1000, mode: "async" })).rejects.toThrow();
  });
  it("fails closed when required Worker capabilities are absent", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...hello, capabilities: [] }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).listWorkspaces()).rejects.toThrow(/capability missing/); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
