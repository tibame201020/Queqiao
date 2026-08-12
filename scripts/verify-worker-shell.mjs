#!/usr/bin/env node
import { readFile } from "node:fs/promises";

const [url, tokenFile, workspaceId, command, shell = "default"] = process.argv.slice(2);
if (!url || !tokenFile || !workspaceId || !command) {
  throw new Error("Usage: verify-worker-shell <worker-url> <token-file> <workspace-id> <command>");
}
const token = (await readFile(tokenFile, "utf8")).trim();
const response = await fetch(new URL("/v1/tools/shell", url), {
  method: "POST",
  headers: { "content-type": "application/json", "x-queqiao-worker-token": token },
  body: JSON.stringify({ workspaceId, shell, command, cwd: ".", timeoutMs: 5000 }),
  signal: AbortSignal.timeout(10_000),
});
const result = await response.json();
if (!response.ok) throw new Error(`Worker returned HTTP ${response.status}: ${JSON.stringify(result)}`);
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
