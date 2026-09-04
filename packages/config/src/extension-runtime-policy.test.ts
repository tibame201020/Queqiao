import { describe, expect, it } from "vitest";
import { extensionManifestSchema, extensionRuntimePolicyFor } from "./index.js";

const manifest = {
  id: "dev.queqiao.runtime-probe",
  version: "1.0.0",
  displayName: "Runtime probe",
  host: { kind: "worker" as const },
  contributions: [],
};

function policyFor(parsed: ReturnType<typeof extensionManifestSchema.parse>) {
  return extensionRuntimePolicyFor(parsed.runtime ? { runtime: parsed.runtime } : {});
}

describe("Extension runtime policy", () => {
  it("defaults downstream process and network authority to deny", () => {
    const parsed = extensionManifestSchema.parse(manifest);
    expect(policyFor(parsed)).toEqual({ processes: { allow: [] }, outboundHttp: { allowOrigins: [] } });
  });

  it("accepts bounded executable basenames and exact HTTP origins", () => {
    const parsed = extensionManifestSchema.parse({
      ...manifest,
      runtime: {
        processes: { allow: ["node", "python3"] },
        outboundHttp: { allowOrigins: ["https://mcp.example.com", "http://127.0.0.1:8123"] },
      },
    });
    expect(policyFor(parsed)).toEqual({
      processes: { allow: ["node", "python3"] },
      outboundHttp: { allowOrigins: ["https://mcp.example.com", "http://127.0.0.1:8123"] },
    });
  });

  it("rejects shell/path executables and non-origin network grants", () => {
    expect(() => extensionManifestSchema.parse({ ...manifest, runtime: { processes: { allow: ["../node"] } } })).toThrow();
    expect(() => extensionManifestSchema.parse({ ...manifest, runtime: { outboundHttp: { allowOrigins: ["https://mcp.example.com/rpc"] } } })).toThrow();
    expect(() => extensionManifestSchema.parse({ ...manifest, runtime: { outboundHttp: { allowOrigins: ["file:///tmp/socket"] } } })).toThrow();
  });
});
