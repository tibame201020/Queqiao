import {
  WebStandardStreamableHTTPServerTransport,
  createMcpHandler,
  isLegacyRequest,
  type McpHandlerRequestOptions,
} from "@modelcontextprotocol/server";
import { toNodeHandler, type FetchLikeMcpHandler, type NodeMcpRequestHandler } from "@modelcontextprotocol/node";
import { createMcpServer } from "./mcp.js";
import {
  McpCancellationCapacityError,
  extractCancelledRequest,
  extractToolCallRequestIds,
  type CancellationLease,
  type McpCancellationRegistry,
} from "./cancellation-registry.js";
import type { WorkerRegistry } from "./worker-registry.js";
import type { InstalledExtensionConfig } from "@queqiao/config";

export type McpNodeAdapter = {
  handle: NodeMcpRequestHandler;
  close(): Promise<void>;
};

function withLeaseCleanup(response: Response, release: () => void): Response {
  if (!response.body || response.headers.get("content-type")?.startsWith("text/event-stream") !== true) {
    release();
    return response;
  }
  const reader = response.body.getReader();
  let released = false;
  const done = () => { if (!released) { released = true; release(); } };
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) { done(); controller.close(); return; }
        if (next.value !== undefined) controller.enqueue(next.value);
      } catch (error) { done(); controller.error(error); }
    },
    async cancel(reason) { done(); await reader.cancel(reason).catch(() => {}); },
  });
  return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
}

export function createMcpNodeAdapter(
  workers: WorkerRegistry,
  scopes: readonly string[],
  cancellation?: { principalId: string; registry: McpCancellationRegistry },
  extensions: readonly InstalledExtensionConfig[] = [],
): McpNodeAdapter {
  const factory = () => createMcpServer(workers, scopes, cancellation, extensions);
  const modern = createMcpHandler(factory, {
    legacy: "reject",
    responseMode: "auto",
    onerror: (error) => console.error("MCP modern handler error", error),
  });
  const activeLeases = new Set<CancellationLease>();

  const composite: FetchLikeMcpHandler = {
    async fetch(request: Request, options?: McpHandlerRequestOptions): Promise<Response> {
      const parsedBody = options?.parsedBody;
      const leases: CancellationLease[] = [];
      const releaseLeases = () => {
        for (const lease of leases) { activeLeases.delete(lease); lease.release(); }
        leases.length = 0;
      };
      if (cancellation) {
        const cancelled = extractCancelledRequest(parsedBody);
        if (cancelled) cancellation.registry.cancel(cancellation.principalId, cancelled.requestId, cancelled.reason);
        try {
          for (const requestId of extractToolCallRequestIds(parsedBody)) {
            const lease = cancellation.registry.begin(cancellation.principalId, requestId);
            leases.push(lease); activeLeases.add(lease);
          }
        } catch (error) {
          releaseLeases();
          if (error instanceof McpCancellationCapacityError) {
            return Response.json({ jsonrpc: "2.0", error: { code: -32000, message: error.message }, id: null }, { status: 429 });
          }
          throw error;
        }
      }

      try {
        if (!await isLegacyRequest(request, parsedBody)) {
          return withLeaseCleanup(await modern.fetch(request, options), releaseLeases);
        }

        const server = factory();
        const transport = new WebStandardStreamableHTTPServerTransport({
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        const close = () => Promise.allSettled([transport.close(), server.close()]);
        request.signal.addEventListener("abort", () => { void close(); }, { once: true });
        try {
          await server.connect(transport);
          const response = await transport.handleRequest(request, {
            ...(options?.authInfo ? { authInfo: options.authInfo } : {}),
            ...(parsedBody !== undefined ? { parsedBody } : {}),
          });
          if (response.headers.get("content-type")?.startsWith("text/event-stream") !== true) await close();
          return withLeaseCleanup(response, releaseLeases);
        } catch (error) {
          await close();
          throw error;
        }
      } catch (error) {
        releaseLeases();
        throw error;
      }
    },
  };

  return {
    handle: toNodeHandler(composite, { onerror: (error) => console.error("MCP Node adapter error", error) }),
    close: async () => {
      for (const lease of activeLeases) lease.release();
      activeLeases.clear();
      await modern.close();
    },
  };
}
