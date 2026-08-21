import type { InstalledExtensionConfig } from "@queqiao/config";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS } from "@queqiao/mcp-compat";
import { buildOperationsDiagnostics } from "@queqiao/operations";
import { QUEQIAO_WORKER_PROTOCOL_VERSION } from "@queqiao/worker-protocol";

export function gatewayOperationsDiagnostics(extensions: readonly InstalledExtensionConfig[]) {
  return buildOperationsDiagnostics({
    coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION,
    workerProtocolVersion: QUEQIAO_WORKER_PROTOCOL_VERSION,
    supportedMcpProtocolVersions: QUEQIAO_SUPPORTED_MCP_PROTOCOL_VERSIONS,
    coreTools: CORE_PUBLIC_TOOLS,
    extensions,
  });
}
