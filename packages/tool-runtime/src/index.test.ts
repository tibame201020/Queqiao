import { z } from "zod";
import { describe, expect, it } from "vitest";
import { ToolRuntime, type QueqiaoExtension } from "./index.js";

type Context = { allowed: boolean };

function extension(name = "example"): QueqiaoExtension<Context> {
  return {
    manifest: { id: `dev.queqiao.${name}`, version: "1.0.0", displayName: name, supportedEnvironments: ["gateway"] },
    activate(api) {
      api.registerTool({
        name,
        title: name,
        description: "test tool",
        inputSchema: z.object({ value: z.string() }),
        requiredCapabilities: ["workspace:read"],
        risk: "read",
        annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
        execute: (input) => Promise.resolve((input as { value: string }).value),
      });
      api.onBeforeToolCall((call) => call.context.allowed ? undefined : { block: true, reason: "blocked" });
    },
  };
}

describe("ToolRuntime", () => {
  it("registers typed tools and applies hooks", async () => {
    const runtime = new ToolRuntime<Context>();
    runtime.registerExtension(extension());
    runtime.seal();
    expect(runtime.definitions().map(({ name }) => name)).toEqual(["example"]);
    await expect(runtime.execute("example", { value: "ok" }, { allowed: true })).resolves.toBe("ok");
    await expect(runtime.execute("example", { value: "no" }, { allowed: false })).rejects.toThrow("blocked");
  });

  it("rejects collisions and registrations after sealing", () => {
    const runtime = new ToolRuntime<Context>();
    runtime.registerExtension(extension());
    expect(() => runtime.registerExtension(extension("example"))).toThrow(/already registered/);
    runtime.seal();
    expect(() => runtime.registerExtension(extension("later"))).toThrow(/sealed/);
  });

  it("rejects invalid manifests before activation", () => {
    const runtime = new ToolRuntime<Context>();
    const invalid = extension("invalid");
    invalid.manifest = { ...invalid.manifest, id: "invalid" };
    expect(() => runtime.registerExtension(invalid)).toThrow(/Invalid extension manifest/);
    expect(runtime.definitions()).toHaveLength(0);
  });
});
