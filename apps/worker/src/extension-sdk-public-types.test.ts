import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as ts from "typescript";
import { afterEach, describe, expect, it } from "vitest";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

const repoRoot = path.resolve(import.meta.dirname, "../../..");

describe("published extension runtime types", () => {
  it("compiles an external consumer using only @tibame201020/queqiao/extension", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-sdk-types-"));
    const fixture = path.join(temporary, "consumer.ts");
    await writeFile(fixture, `
import { defineExtension, defineExtensionManifest, type WorkerExtensionContext } from "@tibame201020/queqiao/extension";

const manifest = defineExtensionManifest({
  id: "dev.example.remote-mcp",
  version: "1.0.0",
  displayName: "Remote MCP",
  host: { kind: "worker" },
  ordering: { requires: [], before: [], after: [] },
  contributions: [],
  runtime: {
    processes: { allow: ["node"] },
    outboundHttp: { allowOrigins: ["https://mcp.example.com"] },
  },
});

async function useRuntime(context: WorkerExtensionContext) {
  const session = await context.runtime.stdio.open({ executable: "node", args: ["server.js"], cwd: ".", timeoutMs: 1000 });
  await session.write("{}\\n");
  const event = await session.next();
  const response = await context.runtime.http.request({ url: "https://mcp.example.com/mcp", method: "POST", body: "{}", timeoutMs: 1000 });
  return [event.type, response.status] as const;
}

export default defineExtension<WorkerExtensionContext>({
  manifest: { id: manifest.id, version: manifest.version, displayName: manifest.displayName },
  activate() { void useRuntime; },
});
`, "utf8");

    const program = ts.createProgram([fixture], {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.NodeNext,
      moduleResolution: ts.ModuleResolutionKind.NodeNext,
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      baseUrl: repoRoot,
      paths: { "@tibame201020/queqiao/extension": ["extension.d.ts"] },
      types: ["node"],
    });
    const diagnostics = ts.getPreEmitDiagnostics(program);
    const messages = diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
    expect(messages).toEqual([]);
  });
});
