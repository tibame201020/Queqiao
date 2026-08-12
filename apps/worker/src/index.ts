import { loadRuntimeEnvironment } from "@queqiao/platform-paths";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWorkerApp } from "./app.js";

function required(name: string): string { const value = process.env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
await loadRuntimeEnvironment();
const port = Number(process.env.QUEQIAO_WORKER_PORT || "7576");
const defaultWorkspaceId = process.env.QUEQIAO_WORKSPACE_ID?.trim() || "default";
const configFile = process.env.QUEQIAO_WORKSPACES_FILE?.trim();
const workerToken = process.env.QUEQIAO_WORKER_TOKEN_FILE?.trim() ? readFileSync(path.resolve(process.env.QUEQIAO_WORKER_TOKEN_FILE), "utf8").trim() : required("QUEQIAO_WORKER_TOKEN");
if (Buffer.byteLength(workerToken) < 32) throw new Error("QUEQIAO_WORKER_TOKEN must be at least 32 bytes");
const workspaces = !configFile
  ? [{ id: defaultWorkspaceId, displayName: defaultWorkspaceId, root: path.resolve(required("QUEQIAO_WORKSPACE_ROOT")), profile: "read-only" as const, tools: { allow: [], deny: [] }, commands: { allow: [] } }]
  : undefined;
const app = await createWorkerApp({ environmentId: process.env.QUEQIAO_ENVIRONMENT_ID?.trim() || "windows", defaultWorkspaceId, ...(configFile ? { workspacesFile: path.resolve(configFile) } : { workspaces: workspaces! }), workerToken });
app.listen(port, "127.0.0.1", () => console.log(`Queqiao Worker listening on http://127.0.0.1:${port}`));
