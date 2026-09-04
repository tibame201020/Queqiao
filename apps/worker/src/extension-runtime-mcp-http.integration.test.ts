import { createServer, type Server } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { ProcessRunner } from "@queqiao/process-runtime";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { WorkspaceCatalog } from "./workspace-catalog.js";
import { WorkerExtensionRuntimeServices } from "./extension-runtime-services.js";

let temporary: string | undefined;
let server: Server | undefined;

afterEach(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  server = undefined;
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

async function runtimeFor(origin: string): Promise<WorkerExtensionRuntimeServices> {
  temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-mcp-http-"));
  const catalog = new WorkspaceCatalog({
    workspaces: [{
      id: "one",
      displayName: "One",
      root: temporary,
      profile: "read-only",
      tools: { allow: ["extension"], deny: [], explicit: [] },
      commands: { allow: [] },
    }],
  });
  await catalog.initialize();
  return new WorkerExtensionRuntimeServices({
    workspace: catalog.get("one")!,
    processes: new ProcessRunner(),
    policy: { processes: { allow: [] }, outboundHttp: { allowOrigins: [origin] } },
  });
}

async function listenMcp(): Promise<string> {
  const handler = createMcpHandler(() => {
    const mcp = new McpServer({ name: "worker-runtime-http-test", version: "1.0.0" });
    mcp.registerTool(
      "echo-runtime-http",
      { title: "Runtime HTTP Echo", description: "Echo through Worker-owned HTTP", inputSchema: z.object({ text: z.string() }) },
      async ({ text }) => ({ content: [{ type: "text", text }], structuredContent: { text } }),
    );
    return mcp;
  });
  server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) {
      if (Array.isArray(value)) value.forEach((entry) => headers.append(name, entry));
      else if (value !== undefined) headers.set(name, value);
    }
    const body = Buffer.concat(chunks);
    const response = await handler.fetch(new Request(`http://${req.headers.host}${req.url ?? "/"}`, {
      method: req.method ?? "GET",
      headers,
      ...(body.length ? { body } : {}),
    }));
    res.statusCode = response.status;
    response.headers.forEach((value, name) => res.setHeader(name, value));
    if (!response.body) { res.end(); return; }
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server!.once("error", reject);
    server!.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Expected TCP listener");
  return `http://127.0.0.1:${address.port}`;
}

describe("Worker extension runtime MCP Streamable HTTP integration", () => {
  it("injects Worker-owned fetch into the official MCP transport and preserves streamed responses", async () => {
    const origin = await listenMcp();
    const runtime = await runtimeFor(origin);
    const client = new Client({ name: "queqiao-runtime-test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL(`${origin}/mcp`), { fetch: runtime.http.fetch });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      expect(tools.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "echo-runtime-http" })]));
      const result = await client.callTool({ name: "echo-runtime-http", arguments: { text: "through-worker" } });
      expect(result).toMatchObject({ structuredContent: { text: "through-worker" } });
    } finally {
      await client.close().catch(() => undefined);
    }
  });
});
