import { McpServer, fromJsonSchema, type JsonSchemaType } from "@modelcontextprotocol/server";
import { ToolRuntime, extensionActiveForWorkspace, resolveExtensionComposition } from "@queqiao/tool-runtime";
import type { InstalledExtensionConfig } from "@queqiao/config";
import { coreWorkspaceTools, type GatewayToolContext } from "./core-tools.js";
import type { WorkerRegistry } from "./worker-registry.js";
import { CORE_PUBLIC_TOOL_ORDER, CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS } from "@queqiao/mcp-compat";
import { buildOperationsDiagnostics, publicOperationsProjection } from "@queqiao/operations";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";
import type { McpCancellationRegistry } from "./cancellation-registry.js";
import { toQueqiaoErrorEnvelope } from "./errors.js";

export const QUEQIAO_V0_TOOL_NAMES = ["workspace_info", "read_file"] as const;
export const QUEQIAO_MULTI_WORKSPACE_TOOL_NAMES = CORE_PUBLIC_TOOL_ORDER;

function result(value: unknown) {
  return { content: [{ type: "text" as const, text: typeof value === "string" ? value : JSON.stringify(value, null, 2) }] };
}

function failure(error: unknown) {
  return { isError: true, content: [{ type: "text" as const, text: JSON.stringify(toQueqiaoErrorEnvelope(error)) }] };
}

export function createGatewayToolRuntime(): ToolRuntime<GatewayToolContext> {
  const runtime = new ToolRuntime<GatewayToolContext>();
  runtime.registerExtension(coreWorkspaceTools);
  return runtime.seal();
}

export function createMcpServer(workers: WorkerRegistry, scopes: readonly string[], cancellation?: { principalId: string; registry: McpCancellationRegistry }, extensions: readonly InstalledExtensionConfig[] = []): McpServer {
  const server = new McpServer({ name: "queqiao-mcp", version: "0.1.0" }, { supportedProtocolVersions: [...QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS] });
  const runtime = createGatewayToolRuntime();
  const diagnostics = buildOperationsDiagnostics({
    coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION,
    workerProtocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION,
    supportedMcpProtocolVersions: QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS,
    coreTools: CORE_PUBLIC_TOOLS,
    extensions,
  });
  const context: GatewayToolContext = { workers, oauthScopes: new Set(scopes), deployment: publicOperationsProjection(diagnostics) };

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
          const correlated = cancellation?.registry.signalFor(cancellation.principalId, extra.mcpReq.id);
          const signal = correlated ? AbortSignal.any([extra.mcpReq.signal, correlated]) : extra.mcpReq.signal;
          return result(await runtime.execute(definition.name, input, { ...context, signal }));
        } catch (error) {
          return failure(error);
        }
      },
    );
  }
  resolveExtensionComposition(extensions.map((extension) => extension.manifest), definitions.map((definition) => definition.name));
  const publicContributions = extensions.flatMap((extension) => extension.manifest.contributions
    .filter((contribution): contribution is Extract<typeof contribution, { operation: "register" }> => contribution.operation === "register" && contribution.visibility === "public")
    .map((contribution) => ({ extension, contribution })))
    .sort((left, right) => left.contribution.tool.localeCompare(right.contribution.tool));
  for (const { extension, contribution } of publicContributions) {
    if (extension.manifest.host.kind !== "worker") throw new Error(`Gateway-hosted public extension execution is not wired: ${extension.manifest.id}`);
    const workerHost = extension.manifest.host;
    server.registerTool(
      contribution.tool,
      {
        title: contribution.title,
        description: contribution.description,
        inputSchema: fromJsonSchema(contribution.inputSchema as JsonSchemaType),
        annotations: contribution.annotations,
      },
      async (input, extra) => {
        try {
          if (!context.oauthScopes.has("queqiao:access")) throw new Error("Missing OAuth scope: queqiao:access");
          const requested = input && typeof input === "object" && typeof (input as { workspaceId?: unknown }).workspaceId === "string" ? (input as { workspaceId: string }).workspaceId : undefined;
          const selected = requested || (await context.workers.implicitRoute()).workspaceId;
          if (!extensionActiveForWorkspace(extension, selected)) throw new Error(`${contribution.tool} is not active for Workspace ${selected}`);
          const route = await context.workers.workspaceRoute(selected);
          if (workerHost.environmentId && workerHost.environmentId !== route.environmentId) throw new Error(`${contribution.tool} is not hosted by Workspace environment ${route.environmentId}`);
          await context.workers.requireTool(selected, contribution.tool);
          const correlated = cancellation?.registry.signalFor(cancellation.principalId, extra.mcpReq.id);
          const signal = correlated ? AbortSignal.any([extra.mcpReq.signal, correlated]) : extra.mcpReq.signal;
          const forwarded = input && typeof input === "object" && !Array.isArray(input) ? { ...(input as Record<string, unknown>), workspaceId: selected } : { workspaceId: selected };
          return result(await context.workers.invokeTool(contribution.tool, forwarded, signal));
        } catch (error) {
          return failure(error);
        }
      },
    );
  }
  return server;
}
