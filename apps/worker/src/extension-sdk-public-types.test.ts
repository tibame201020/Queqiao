import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

const repoRoot = path.resolve(import.meta.dirname, "../../..");

describe("published extension runtime types", () => {
  it("compiles an external ESM consumer using only @tibame201020/queqiao/extension", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-sdk-types-"));
    const fixture = path.join(temporary, "consumer.ts");
    const tsconfig = path.join(temporary, "tsconfig.json");
    await writeFile(path.join(temporary, "package.json"), JSON.stringify({ name: "runtime-consumer-fixture", private: true, type: "module" }), "utf8");
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
    await writeFile(tsconfig, JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        baseUrl: repoRoot,
        paths: { "@tibame201020/queqiao/extension": ["extension.d.ts"] },
        types: [],
      },
      files: [fixture],
    }, null, 2), "utf8");

    const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");
    const result = await execFileAsync(process.execPath, [tsc, "--project", tsconfig, "--pretty", "false"], { cwd: repoRoot });
    expect(result.stderr).toBe("");
  });
});
