import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessRunner } from "@queqiao/process-runtime";
import type { ExtensionRuntimePolicy } from "@queqiao/config";
import { WorkspaceCatalog, type WorkspaceEntry } from "./workspace-catalog.js";
import { WorkerExtensionRuntimeServices } from "./extension-runtime-services.js";

let temporary: string | undefined;
let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

async function workspace(): Promise<WorkspaceEntry> {
  temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-runtime-"));
  const catalog = new WorkspaceCatalog({ workspaces: [{ id: "one", displayName: "One", root: temporary, profile: "read-only", tools: { allow: ["extension"], deny: [], explicit: [] }, commands: { allow: [] } }] });
  await catalog.initialize();
  return catalog.get("one")!;
}

function policy(input: Partial<ExtensionRuntimePolicy> = {}): ExtensionRuntimePolicy {
  return {
    processes: input.processes ?? { allow: [] },
    outboundHttp: input.outboundHttp ?? { allowOrigins: [] },
  };
}

async function listen(handler: Parameters<typeof createServer>[0]): Promise<string> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("test server did not bind TCP");
  return `http://127.0.0.1:${address.port}`;
}

describe("Worker extension runtime services", () => {
  it("defaults process and network access to deny", async () => {
    const entry = await workspace();
    const runtime = new WorkerExtensionRuntimeServices({ workspace: entry, processes: new ProcessRunner(), policy: policy() });
    await expect(runtime.stdio.open({ executable: path.basename(process.execPath), args: ["-e", "0"], cwd: ".", timeoutMs: 1000 })).rejects.toMatchObject({ code: "extension_process_denied" });
    await expect(runtime.http.request({ url: "https://example.com/", method: "GET", timeoutMs: 1000 })).rejects.toMatchObject({ code: "extension_network_denied" });
  });

  it("allows declared native stdio execution while retaining workspace cwd containment", async () => {
    const entry = await workspace();
    const executable = path.basename(process.execPath);
    const runtime = new WorkerExtensionRuntimeServices({ workspace: entry, processes: new ProcessRunner(), policy: policy({ processes: { allow: [executable] } }) });
    const session = await runtime.stdio.open({ executable, args: ["-e", "process.stdin.once('data',d=>{process.stdout.write(d);process.exit(0)})"], cwd: ".", timeoutMs: 2000 });
    await session.write("hello\n");
    await expect(session.next()).resolves.toEqual({ type: "stdout", data: "hello\n" });
    await expect(session.closed).resolves.toMatchObject({ exitCode: 0 });
    await expect(runtime.stdio.open({ executable, args: ["-e", "0"], cwd: "..", timeoutMs: 1000 })).rejects.toThrow(/escapes the workspace|outside/i);
  });

  it("allows only exact declared HTTP origins and does not follow redirects", async () => {
    const entry = await workspace();
    const origin = await listen((req, res) => {
      if (req.url === "/redirect") { res.statusCode = 302; res.setHeader("location", "https://example.com/"); res.end(); return; }
      let body = "";
      req.setEncoding("utf8");
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => { res.setHeader("content-type", "text/plain"); res.end(`${req.method}:${body}`); });
    });
    const runtime = new WorkerExtensionRuntimeServices({ workspace: entry, processes: new ProcessRunner(), policy: policy({ outboundHttp: { allowOrigins: [origin] } }) });
    await expect(runtime.http.request({ url: `${origin}/mcp`, method: "POST", body: "{}", timeoutMs: 1000 })).resolves.toMatchObject({ status: 200, body: "POST:{}" });
    await expect(runtime.http.request({ url: "https://example.com/mcp", method: "POST", body: "{}", timeoutMs: 1000 })).rejects.toMatchObject({ code: "extension_network_denied" });
    await expect(runtime.http.request({ url: `${origin}/redirect`, method: "GET", timeoutMs: 1000 })).rejects.toMatchObject({ code: "extension_http_redirect_denied" });
  });

  it("bounds HTTP response bodies and propagates request cancellation", async () => {
    const entry = await workspace();
    const origin = await listen((req, res) => {
      if (req.url === "/large") { res.end("x".repeat(1024 * 1024 + 1)); return; }
      setTimeout(() => res.end("late"), 1000);
    });
    const runtime = new WorkerExtensionRuntimeServices({ workspace: entry, processes: new ProcessRunner(), policy: policy({ outboundHttp: { allowOrigins: [origin] } }) });
    await expect(runtime.http.request({ url: `${origin}/large`, method: "GET", timeoutMs: 2000 })).rejects.toMatchObject({ code: "extension_http_response_too_large" });
    const abort = new AbortController();
    const pending = runtime.withSignal(abort.signal).http.request({ url: `${origin}/slow`, method: "GET", timeoutMs: 2000 });
    abort.abort(new Error("cancel extension request"));
    await expect(pending).rejects.toThrow(/cancel extension request|aborted/i);
  });
});
