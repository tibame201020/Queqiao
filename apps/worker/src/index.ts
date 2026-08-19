import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { readRuntimeConfig } from "@queqiao/config";
import { ProcessRunner } from "@queqiao/process-runtime";
import { ExtensionHost } from "@queqiao/tool-runtime";
import gitExtension from "@queqiao/extension-git";
import { getWorkerCoreToolDefinitions, type WorkerToolContext } from "./core-tools.js";
import path from "node:path";
import { createWorkerApp } from "./app.js";
import { WorkerCredentialSource } from "./worker-credential-source.js";

const layout = resolveRuntimeLayout();
const configFile = path.resolve(process.env.QUEQIAO_CONFIG_FILE || layout.configFile);
const runtime = await readRuntimeConfig(configFile);
if (!runtime.worker) throw new Error("worker configuration is required");
const port = runtime.worker.listen.port;
const defaultWorkspaceId = runtime.worker.defaultWorkspaceId;
if (!defaultWorkspaceId) throw new Error("Worker has no Workspace; add one before serving");
const credentialFile = path.resolve(runtime.worker.tokenFile);
const credential = new WorkerCredentialSource(credentialFile);
await credential.current();
const extensionHost = new ExtensionHost<WorkerToolContext>(
  runtime.extensions,
  { kind: "worker", environmentId: runtime.worker.environmentId },
  path.dirname(configFile),
  async (specifier) => specifier === "@queqiao/extension-git" ? { default: gitExtension } : import(specifier),
  getWorkerCoreToolDefinitions().map((tool) => tool.name),
);
await extensionHost.load();
const processes = new ProcessRunner();
const app = await createWorkerApp({ ...(runtime.worker.workerId ? { workerId: runtime.worker.workerId } : {}), environmentId: runtime.worker.environmentId, defaultWorkspaceId, workspacesFile: configFile, workerCredential: credential, processes, extensionHost });
const server = app.listen(port, "127.0.0.1", () => console.log(`Queqiao Worker listening on http://127.0.0.1:${port}`));

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  server.close();
  processes.shutdown();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
