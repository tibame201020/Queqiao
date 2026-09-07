import express from "express";
import type { Server } from "node:http";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";
import type { InstalledExtensionConfig } from "@queqiao/config";
import { mcpToolResult } from "@queqiao/extension-sdk";
import { createMcpNodeAdapter } from "./mcp-adapter.js";
import type { WorkerRegistry } from "./worker-registry.js";

const installed: InstalledExtensionConfig = {
  trusted: true,
  source: { kind: "local-module", module: "virtual:native-result" },
  activation: { kind: "global" },
  manifest: {
    id: "dev.queqiao.native-result-test",
    version: "1.0.0",
    displayName: "Native result test",
    host: { kind: "worker" },
    ordering: { requires: [], before: [], after: [] },
    contributions: [{
      operation: "register",
      tool: "native_result_probe",
      visibility: "public",
      title: "Native result probe",
      description: "Tests explicit MCP-native extension results",
      inputSchema: {
        type: "object",
        properties: { workspaceId: { type: "string" } },
        required: ["workspaceId"],
        additionalProperties: false,
      },
      requiredCapabilities: [],
      risk: "read",
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    }],
  },
};

let server: Server | undefined;
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});

async function callProbe(value: unknown, revision: "2025-11-25" | "2026-07-28") {
  const workers = {
    async implicitRoute() { return { workspaceId: "coding" }; },
    async workspaceRoute(workspaceId: string) {
      return {
        workspaceId,
        environmentId: "windows",
        displayName: "Coding",
        root: "redacted",
        profile: "coding",
        tools: { allow: [], deny: [], explicit: [] },
        commands: { allow: [] },
        online: true as const,
      };
    },
    async requireTool() {},
    async invokeTool() {
      return {
        value,
        routing: { environmentId: "windows", requestedTransport: null, selectedTransport: "http", selectionReason: "configured_order" },
      };
    },
  } as unknown as WorkerRegistry;

  const adapter = createMcpNodeAdapter(workers, ["queqiao:access"], undefined, [installed]);
  const app = express();
  app.use(express.json());
  app.post("/mcp", (req, res) => { void adapter.handle(req, res, req.body); });
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("listen failed");

  const client = new Client(
    { name: "native-result-contract", version: "1" },
    revision === "2026-07-28"
      ? { supportedProtocolVersions: [revision], versionNegotiation: { mode: { pin: revision } } }
      : { supportedProtocolVersions: [revision], versionNegotiation: { mode: "legacy" } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${address.port}/mcp`));
  try {
    await client.connect(transport);
    return await client.callTool({ name: "native_result_probe", arguments: { workspaceId: "coding" } });
  } finally {
    await transport.close();
    await adapter.close();
  }
}

describe("Gateway MCP-native extension result projection", () => {
  it("keeps ordinary JSON and image-shaped objects on the legacy text projection", async () => {
    const value = { content: [{ type: "image", data: "iVBORw0KGgo=", mimeType: "image/png" }], ordinary: true };
    const call = await callProbe(value, "2025-11-25");
    expect(call.content).toHaveLength(1);
    expect(call.content[0]?.type).toBe("text");
    expect(call.content[0]).toMatchObject({ type: "text" });
    expect(JSON.stringify(call.content)).toContain("ordinary");
  });

  it("passes an explicitly marked image result through on MCP 2025-11-25", async () => {
    const image = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };
    const call = await callProbe(mcpToolResult({ content: [image] }), "2025-11-25");
    expect(call.content).toEqual([image]);
  });

  it("passes an explicitly marked image result through on MCP 2026-07-28", async () => {
    const image = { type: "image" as const, data: "iVBORw0KGgo=", mimeType: "image/png" };
    const call = await callProbe(mcpToolResult({ content: [image] }), "2026-07-28");
    expect(call.content).toEqual([image]);
  });

  it("does not pass through a marked value that fails the MCP CallToolResult schema", async () => {
    const invalid = mcpToolResult({ content: [{ type: "image" }] });
    const call = await callProbe(invalid, "2025-11-25");
    expect(call.content).toHaveLength(1);
    expect(call.content[0]?.type).toBe("text");
    expect(JSON.stringify(call.content)).toContain("mcp_tool_result");
  });
});
