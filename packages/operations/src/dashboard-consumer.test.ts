import { describe, expect, it } from "vitest";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { buildOperationsDiagnostics } from "./index.js";

function dashboardConsumer() {
  return buildOperationsDiagnostics({
    coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION,
    workerProtocolVersion: "2.0",
    supportedMcpProtocolVersions: ["2026-07-28"],
    coreTools: CORE_PUBLIC_TOOLS,
    extensions: [],
  });
}

describe("Dashboard-ready operations contract", () => {
  it("uses the same structured diagnostics contract rather than a Dashboard-specific composition engine", () => {
    const dashboard = dashboardConsumer();
    const cliEquivalent = buildOperationsDiagnostics({
      coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION,
      workerProtocolVersion: "2.0",
      supportedMcpProtocolVersions: ["2026-07-28"],
      coreTools: CORE_PUBLIC_TOOLS,
      extensions: [],
    });
    expect(dashboard).toEqual(cliEquivalent);
  });
});
