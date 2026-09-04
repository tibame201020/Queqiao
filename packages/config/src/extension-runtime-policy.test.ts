import { describe, expect, it } from "vitest";
import { extensionManifestSchema } from "./index.js";

const manifest = {
  id: "dev.queqiao.runtime-probe",
  version: "1.0.0",
  displayName: "Runtime probe",
  host: { kind: "worker" as const },
  contributions: [],
};

describe("Extension runtime policy", () => {
  it("defaults downstream process and network authority to deny", () => {
    const parsed = extensionManifestSchema.parse(manifest) as typeof manifest & { runtime: unknown };
    expect(parsed.runtime).toEqual({ processes: { allow: [] }, outboundHttp: { allowOrigins: [] } });
  });

  it("accepts bounded executable basenames and exact HTTP origins", () => {
    const parsed = extensionManifestSchema.parse({
      ...manifest,
      runtime: {
        processes: { allow: ["node", "python3"] },
        outboundHttp: { allowOrigins: ["https://mcp.example.com", "http://127.0.0.1:8123"] },
      },
    }) as typeof manifest & { runtime: { processes: { allow: string[] }; outboundHttp: { allowOrigins: string[] } } };
    expect(parsed.runtime.processes.allow).toEqual(["node", "python3"]);
    expect(parsed.runtime.outboundHttp.allowOrigins).toEqual(["https://mcp.example.com", "http://127.0.0.1:8123"]);
  });

  it("rejects shell/path executables and non-origin network grants", () => {
    expect(() => extensionManifestSchema.parse({ ...manifest, runtime: { processes: { allow: ["../node"] } } })).toThrow();
    expect(() => extensionManifestSchema.parse({ ...manifest, runtime: { outboundHttp: { allowOrigins: ["https://mcp.example.com/rpc"] } } })).toThrow();
    expect(() => extensionManifestSchema.parse({ ...manifest, runtime: { outboundHttp: { allowOrigins: ["file:///tmp/socket"] } } })).toThrow();
  });
});
