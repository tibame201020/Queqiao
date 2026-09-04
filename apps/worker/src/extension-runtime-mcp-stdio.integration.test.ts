import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Client, type JSONRPCMessage, type Transport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import { ProcessRunner } from "@queqiao/process-runtime";
import type { WorkerExtensionRuntime } from "@tibame201020/queqiao/extension";
import { WorkspaceCatalog } from "./workspace-catalog.js";
import { WorkerExtensionRuntimeServices } from "./extension-runtime-services.js";

let temporary: string | undefined;

afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});

class WorkerManagedStdioTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: (message: JSONRPCMessage) => void;

  private session?: Awaited<ReturnType<WorkerExtensionRuntime["stdio"]["open"]>>;
  private readLoop?: Promise<void>;
  private buffer = "";
  private closed = false;

  constructor(
    private readonly stdio: WorkerExtensionRuntime["stdio"],
    private readonly input: { executable: string; args: readonly string[]; cwd: string },
  ) {}

  async start(): Promise<void> {
    if (this.session) throw new Error("Worker managed stdio transport already started");
    this.session = await this.stdio.open({ ...this.input, timeoutMs: null });
    this.readLoop = this.readMessages();
  }

  async send(message: JSONRPCMessage): Promise<void> {
    if (!this.session) throw new Error("Worker managed stdio transport is not started");
    await this.session.write(`${JSON.stringify(message)}\n`);
  }

  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    const session = this.session;
    if (session) await session.close().catch(() => undefined);
    await this.readLoop?.catch(() => undefined);
    this.onclose?.();
  }

  private async readMessages(): Promise<void> {
    const session = this.session!;
    try {
      while (!this.closed) {
        const event = await session.next();
        if (event.type !== "stdout") continue;
        this.buffer += event.data;
        while (true) {
          const newline = this.buffer.indexOf("\n");
          if (newline < 0) break;
          const line = this.buffer.slice(0, newline).replace(/\r$/, "");
          this.buffer = this.buffer.slice(newline + 1);
          if (!line.trim()) continue;
          try {
            this.onmessage?.(JSON.parse(line) as JSONRPCMessage);
          } catch (error) {
            this.onerror?.(error instanceof Error ? error : new Error("Invalid downstream MCP JSON"));
          }
        }
      }
    } catch (error) {
      if (!this.closed) this.onerror?.(error instanceof Error ? error : new Error("Managed stdio transport failed"));
    } finally {
      if (!this.closed) {
        this.closed = true;
        this.onclose?.();
      }
    }
  }
}

async function runtimeFor(repoRoot: string): Promise<{ runtime: WorkerExtensionRuntimeServices; runner: ProcessRunner }> {
  temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-mcp-stdio-"));
  const catalog = new WorkspaceCatalog({
    workspaces: [{
      id: "repo",
      displayName: "Repository",
      root: repoRoot,
      profile: "read-only",
      tools: { allow: ["extension"], deny: [], explicit: [] },
      commands: { allow: [] },
    }],
  });
  await catalog.initialize();
  const runner = new ProcessRunner(1, 256 * 1024);
  return {
    runner,
    runtime: new WorkerExtensionRuntimeServices({
      workspace: catalog.get("repo")!,
      processes: runner,
      policy: { processes: { allow: [path.basename(process.execPath)] }, outboundHttp: { allowOrigins: [] } },
    }),
  };
}

const downstreamServer = String.raw`
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { z } from "zod";

void serveStdio(() => {
  const server = new McpServer({ name: "worker-runtime-stdio-test", version: "1.0.0" });
  server.registerTool(
    "echo-runtime-stdio",
    {
      title: "Runtime stdio echo",
      description: "Echo through Worker-owned managed stdio",
      inputSchema: z.object({ text: z.string() }),
    },
    async ({ text }) => ({
      content: [{ type: "text", text }],
      structuredContent: { text },
    }),
  );
  return server;
});
`;

describe("Worker extension runtime MCP stdio integration", () => {
  it("connects the official MCP Client through only the public managed stdio contract", async () => {
    const repoRoot = path.resolve(import.meta.dirname, "../../..");
    const { runtime, runner } = await runtimeFor(repoRoot);
    const transport = new WorkerManagedStdioTransport(runtime.stdio, {
      executable: path.basename(process.execPath),
      args: ["--input-type=module", "-e", downstreamServer],
      cwd: ".",
    });
    const client = new Client({ name: "queqiao-runtime-stdio-test", version: "1.0.0" });

    try {
      await client.connect(transport);
      expect(runner.stdioCount()).toBe(1);
      const tools = await client.listTools();
      expect(tools.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: "echo-runtime-stdio" })]));
      const result = await client.callTool({ name: "echo-runtime-stdio", arguments: { text: "through-worker-stdio" } });
      expect(result).toMatchObject({ structuredContent: { text: "through-worker-stdio" } });
    } finally {
      await client.close().catch(() => undefined);
    }

    expect(runner.stdioCount()).toBe(0);
  });
});
