import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerClient } from "./worker-client.js";
import { QUEQIAO_PROTOCOL_VERSION, QUEQIAO_WORKER_CAPABILITIES } from "@queqiao/protocol";

const config = { environmentId: "windows", url: new URL("http://worker.local"), token: "secret" };
const readResult = { path: "a.txt", startLine: 1, endLine: 1, totalLines: 1, text: "ok" };
const hello = { protocolVersion: QUEQIAO_PROTOCOL_VERSION, environmentId: "windows", instanceId: "11111111-1111-4111-8111-111111111111", platform: "windows", capabilities: [...QUEQIAO_WORKER_CAPABILITIES] };

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
    const fetch = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(hello), { status: 200, headers: { "content-type": "application/json" } })).mockResolvedValue(new Response(JSON.stringify({ message: "read_file is denied" }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).readFile({ workspaceId: "one", path: "a.txt", offset: 0, limit: 1 })).rejects.toThrow("denied");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("fails closed before workspace access when the Worker protocol is incompatible", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...hello, protocolVersion: "99.0" }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).listWorkspaces()).rejects.toThrow(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("fails closed when required Worker capabilities are absent", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ...hello, capabilities: [] }), { status: 200, headers: { "content-type": "application/json" } })); vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).listWorkspaces()).rejects.toThrow(/capability missing/); expect(fetch).toHaveBeenCalledTimes(1);
  });
});
