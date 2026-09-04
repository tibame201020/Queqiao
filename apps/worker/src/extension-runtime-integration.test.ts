import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { extensionManifestSchema, installedExtensionSchema } from "@queqiao/config";
import type { WorkerExtensionRuntime } from "@queqiao/extension-sdk";
import { ExtensionHost, type ToolDefinition } from "@queqiao/tool-runtime";
import { createWorkerProtocolService } from "./worker-protocol-service.js";
import type { WorkerToolContext } from "./core-tools.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

function registeredTool(executable: string): ToolDefinition<WorkerToolContext> {
  const inputSchema = z.object({ workspaceId: z.string() });
  return {
    name: "runtime_probe",
    title: "Runtime probe",
    description: "Proves the public extension runtime reaches Worker-owned stdio",
    inputSchema,
    requiredCapabilities: [],
    risk: "execute",
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    async execute(_input, context) {
      const runtime = (context as WorkerToolContext & { runtime: WorkerExtensionRuntime }).runtime;
      const session = await runtime.stdio.open({ executable, args: ["-e", "process.stdin.once('data',d=>{process.stdout.write(d.toString().toUpperCase());process.exit(0)})"], cwd: ".", timeoutMs: null });
      await session.write("extension runtime\n");
      const event = await session.next();
      await session.closed;
      return event;
    },
  };
}

describe("Worker extension runtime integration", () => {
  it("binds the owning manifest runtime policy into a registered extension invocation", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-runtime-integration-"));
    const executable = path.basename(process.execPath);
    const definition = registeredTool(executable);
    const manifest = extensionManifestSchema.parse({
      id: "dev.queqiao.runtime-probe",
      version: "1.0.0",
      displayName: "Runtime probe",
      host: { kind: "worker" },
      runtime: { processes: { allow: [executable] } },
      contributions: [{
        operation: "register",
        tool: definition.name,
        visibility: "internal",
        title: definition.title,
        description: definition.description,
        inputSchema: z.toJSONSchema(definition.inputSchema, { io: "input" }),
        requiredCapabilities: [],
        risk: definition.risk,
        annotations: definition.annotations,
      }],
    });
    const installed = installedExtensionSchema.parse({
      trusted: true,
      source: { kind: "local-module", module: "virtual:runtime-probe" },
      activation: { kind: "global" },
      manifest,
    });
    const host = new ExtensionHost<WorkerToolContext>([installed], { kind: "worker", environmentId: "linux" }, ".", async () => ({
      default: {
        manifest: { id: manifest.id, version: manifest.version, displayName: manifest.displayName },
        activate(api: { registerTool(tool: ToolDefinition<WorkerToolContext>): void }) { api.registerTool(definition); },
      },
    }));
    await host.load();
    const service = await createWorkerProtocolService({
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary, profile: "read-only", tools: { allow: ["extension"], deny: [], explicit: [] }, commands: { allow: [] } }],
      extensionHost: host,
    });

    await expect(service.execute({ operation: "invoke-tool", toolName: definition.name, input: { workspaceId: "one" } })).resolves.toEqual({ result: { type: "stdout", data: "EXTENSION RUNTIME\n" } });
  });
});
