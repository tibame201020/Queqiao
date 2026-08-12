import { afterEach, describe, expect, it, vi } from "vitest";
import { WorkerClient } from "./worker-client.js";

const config = { environmentId: "windows", url: new URL("http://worker.local"), token: "secret" };
const readResult = { path: "a.txt", startLine: 1, endLine: 1, totalLines: 1, text: "ok" };

afterEach(() => vi.unstubAllGlobals());

describe("WorkerClient rolling upgrade", () => {
  it("falls back to the legacy read route only when the invocation route is absent", async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: "tool_not_found" }), { status: 404, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify(readResult), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).readFile({ workspaceId: "one", path: "a.txt", offset: 0, limit: 1 })).resolves.toEqual(readResult);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(String(fetch.mock.calls[1]?.[0])).toContain("/v1/read-file");
  });

  it("does not bypass a policy denial through the legacy route", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ message: "read_file is denied" }), { status: 403, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetch);
    await expect(new WorkerClient(config).readFile({ workspaceId: "one", path: "a.txt", offset: 0, limit: 1 })).rejects.toThrow("denied");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
