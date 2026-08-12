import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { ToolRuntime } from "@queqiao/tool-runtime";
import { coreWorkspaceTools, type GatewayToolContext } from "./core-tools.js";
import type { WorkerRegistry } from "./worker-registry.js";

export const QUEQIAO_V0_TOOL_NAMES = ["workspace_info", "read_file"] as const;
export const QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES = ["workspace_info", "read_file", "list_workspaces", "open_workspace", "write_file", "edit_file", "run", "shell", "list_directory", "search_text"] as const;

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: error instanceof Error ? error.message : "Unknown error" }] };
}

export function createGatewayToolRuntime(): ToolRuntime<GatewayToolContext> {
  const runtime = new ToolRuntime<GatewayToolContext>();
  runtime.registerExtension(coreWorkspaceTools);
  return runtime.seal();
}

export function createMcpServer(workers: WorkerRegistry, scopes: readonly string[]): McpServer {
  const server = new McpServer({ name: "queqiao-mcp", version: "0.1.0" });
  const runtime = createGatewayToolRuntime();
  const context: GatewayToolContext = { workers, oauthScopes: new Set(scopes) };

  const manifestRank = (name: string) => {
    const index = QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES.indexOf(name as typeof QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES[number]);
    return index < 0 ? Number.MAX_SAFE_INTEGER : index;
  };
  const definitions = [...runtime.definitions()].sort((left, right) => manifestRank(left.name) - manifestRank(right.name));
  for (const definition of definitions) {
    server.registerTool(
      definition.name,
      {
        title: definition.title,
        description: definition.description,
        inputSchema: definition.inputSchema.shape,
        annotations: definition.annotations,
      },
      async (input, extra) => {
        try {
          return result(await runtime.execute(definition.name, input, { ...context, signal: extra.signal }));
        } catch (error) {
          return failure(error);
        }
      },
    );
  }
  return server;
}
