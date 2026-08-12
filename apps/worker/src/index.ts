import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { readRuntimeConfig } from "@queqiao/config";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createWorkerApp } from "./app.js";

const layout = resolveRuntimeLayout();
const configFile = path.resolve(process.env.QUEQIAO_CONFIG_FILE || layout.configFile);
const runtime = await readRuntimeConfig(configFile);
if (!runtime.worker) throw new Error("worker configuration is required");
const port = runtime.worker.listen.port;
const defaultWorkspaceId = runtime.worker.defaultWorkspaceId;
const workerToken = readFileSync(path.resolve(runtime.worker.tokenFile), "utf8").trim();
if (Buffer.byteLength(workerToken) < 32) throw new Error("QUEQIAO_WORKER_TOKEN must be at least 32 bytes");
const app = await createWorkerApp({ environmentId: runtime.worker.environmentId, defaultWorkspaceId, workspacesFile: configFile, workerToken });
app.listen(port, "127.0.0.1", () => console.log(`Queqiao Worker listening on http://127.0.0.1:${port}`));
