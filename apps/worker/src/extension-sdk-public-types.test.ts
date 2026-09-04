import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

const repoRoot = path.resolve(import.meta.dirname, "../../..");
const tsc = path.join(repoRoot, "node_modules", "typescript", "bin", "tsc");

type FixturePaths = Record<string, readonly string[]>;

function relativeForTsconfig(from: string, target: string): string {
  const relative = path.relative(from, target).split(path.sep).join("/");
  return relative.startsWith(".") ? relative : `./${relative}`;
}

async function compileFixture(
  source: string,
  compilerOptions: Record<string, unknown>,
  aliases: FixturePaths,
): Promise<void> {
  temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-extension-sdk-types-"));
  const fixture = path.join(temporary, "consumer.ts");
  const tsconfig = path.join(temporary, "tsconfig.json");
  const repoFromFixture = relativeForTsconfig(temporary, repoRoot);
  const paths = Object.fromEntries(Object.entries(aliases).map(([specifier, targets]) => [
    specifier,
    targets.map((target) => `${repoFromFixture}/${target}`),
  ]));
  const types = compilerOptions["types"];
  const resolvedCompilerOptions = {
    ...compilerOptions,
    paths,
    ...(Array.isArray(types) && types.length > 0
      ? { typeRoots: [`${repoFromFixture}/node_modules/@types`] }
      : {}),
  };

  await writeFile(path.join(temporary, "package.json"), JSON.stringify({ name: "runtime-consumer-fixture", private: true, type: "module" }), "utf8");
  await writeFile(fixture, source, "utf8");
  await writeFile(tsconfig, JSON.stringify({ compilerOptions: resolvedCompilerOptions, files: [fixture] }, null, 2), "utf8");
  const result = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    execFile(process.execPath, [tsc, "--project", tsconfig, "--pretty", "false"], { cwd: repoRoot }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`TypeScript fixture compilation failed:\n${stdout}${stderr}`));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("");
}

describe("published extension runtime types", () => {
  it("compiles an external ESM consumer using only @tibame201020/queqiao/extension", async () => {
    await compileFixture(`
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
  const session = await context.runtime.stdio.open({ executable: "node", args: ["server.js"], cwd: ".", timeoutMs: null });
  await session.write("{}\\n");
  const event = await session.next();
  const response = await context.runtime.http.request({ url: "https://mcp.example.com/mcp", method: "POST", body: "{}", timeoutMs: 1000 });
  const streamed = await context.runtime.http.fetch("https://mcp.example.com/mcp", { method: "POST", body: "{}", ...(context.signal ? { signal: context.signal } : {}) });
  return [event.type, response.status, streamed.status] as const;
}

export default defineExtension<WorkerExtensionContext>({
  manifest: { id: manifest.id, version: manifest.version, displayName: manifest.displayName },
  activate() { void useRuntime; },
});
`, {
      target: "ES2022",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: false,
      types: [],
      lib: ["ES2022", "DOM"],
    }, {
      "@tibame201020/queqiao/extension": ["extension.d.ts"],
    });
  });

  it("keeps the internal and published Worker runtime contracts mutually assignable", async () => {
    await compileFixture(`
import type { WorkerExtensionRuntime as InternalRuntime } from "@queqiao/extension-sdk";
import type { WorkerExtensionRuntime as PublishedRuntime } from "@tibame201020/queqiao/extension";

type Assert<T extends true> = T;
type InternalIsPublished = Assert<InternalRuntime extends PublishedRuntime ? true : false>;
type PublishedIsInternal = Assert<PublishedRuntime extends InternalRuntime ? true : false>;
const proof: [InternalIsPublished, PublishedIsInternal] = [true, true];
void proof;
`, {
      target: "ES2023",
      module: "NodeNext",
      moduleResolution: "NodeNext",
      strict: true,
      exactOptionalPropertyTypes: true,
      noEmit: true,
      skipLibCheck: false,
      types: ["node"],
      lib: ["ES2023", "DOM"],
    }, {
      "@tibame201020/queqiao/extension": ["extension.d.ts"],
      "@queqiao/*": ["packages/*/src/index.ts"],
    });
  });
});
