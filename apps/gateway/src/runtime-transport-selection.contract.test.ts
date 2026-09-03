import { describe, expect, it, vi } from "vitest";
import { CORE_PUBLIC_TOOL_CONTRACTS } from "@queqiao/core-manifest";
import { coreWorkspaceTools, unwrapRoutedToolValue } from "./core-tools.js";

function registeredTools() {
  const tools = new Map<string, any>();
  coreWorkspaceTools.activate({ registerTool(tool: any) { tools.set(tool.name, tool); } } as any);
  return tools;
}

const context = (workers: any) => ({
  workers,
  oauthScopes: new Set(["queqiao:access"]),
  deployment: {} as any,
});

const routing = (requestedTransport: string | null, selectedTransport: string, selectionReason: "explicit" | "health_preferred" | "configured_order") => ({
  environmentId: "linux", requestedTransport, selectedTransport, selectionReason,
});
const routedRead = (requestedTransport: string | null, selectedTransport: string, selectionReason: "explicit" | "health_preferred" | "configured_order") => ({
  value: { path: "models", startLine: 1, endLine: 1, totalLines: 1, text: "ok" },
  routing: routing(requestedTransport, selectedTransport, selectionReason),
});

describe("runtime transport selection public contract", () => {
  it("exposes an optional caller-selected transport on Worker-bound MCP tool schemas", () => {
    const parsed: any = CORE_PUBLIC_TOOL_CONTRACTS.read_file.inputSchema.parse({
      workspaceId: "ai-stack",
      path: "models",
      transport: "grpc",
    });
    expect(parsed.transport).toBe("grpc");

    const run: any = CORE_PUBLIC_TOOL_CONTRACTS.run.inputSchema.parse({
      workspaceId: "ai-stack",
      executable: "node",
      transport: "http",
    });
    expect(run.transport).toBe("http");

    const future: any = CORE_PUBLIC_TOOL_CONTRACTS.read_file.inputSchema.parse({
      workspaceId: "ai-stack",
      path: "models",
      transport: "webrtc",
    });
    expect(future.transport).toBe("webrtc");
    expect(() => CORE_PUBLIC_TOOL_CONTRACTS.read_file.inputSchema.parse({ workspaceId: "ai-stack", path: "models", transport: "WebRTC" })).toThrow();
  });

  it("forwards an explicit caller transport unchanged to Gateway Worker routing", async () => {
    const workers = {
      implicitRoute: vi.fn(),
      requireTool: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(routedRead("grpc", "grpc", "explicit")),
    };
    const tool = registeredTools().get("read_file");

    const executed = unwrapRoutedToolValue(await tool.execute({ workspaceId: "ai-stack", path: "models", offset: 0, limit: 1, transport: "grpc" }, context(workers)));

    expect(executed.routing).toEqual(routing("grpc", "grpc", "explicit"));
    expect(workers.readFile).toHaveBeenCalledWith({
      workspaceId: "ai-stack",
      path: "models",
      offset: 0,
      limit: 1,
      transport: "grpc",
    });
  });

  it("keeps transport omitted when the caller wants Gateway deterministic default selection", async () => {
    const workers = {
      implicitRoute: vi.fn(),
      requireTool: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(routedRead(null, "http", "configured_order")),
    };
    const tool = registeredTools().get("read_file");

    const executed = unwrapRoutedToolValue(await tool.execute({ workspaceId: "ai-stack", path: "models", offset: 0, limit: 1 }, context(workers)));

    expect(executed.routing).toEqual(routing(null, "http", "configured_order"));
    expect(workers.readFile.mock.calls[0]?.[0]).not.toHaveProperty("transport");
  });

  it("propagates an explicit transport routing error instead of retrying through another protocol at the MCP layer", async () => {
    const error = Object.assign(new Error("grpc transport is unhealthy"), { code: "transport_unhealthy" });
    const workers = {
      implicitRoute: vi.fn(),
      requireTool: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockRejectedValue(error),
    };
    const tool = registeredTools().get("read_file");

    await expect(tool.execute({ workspaceId: "ai-stack", path: "models", offset: 0, limit: 1, transport: "grpc" }, context(workers))).rejects.toBe(error);
    expect(workers.readFile).toHaveBeenCalledTimes(1);
  });
});
