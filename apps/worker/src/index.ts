import { readFile } from "node:fs/promises";
import path from "node:path";
import { requireRuntimeConfigFile } from "@queqiao/platform-paths";
import { readRuntimeConfig } from "@queqiao/config";
import { ProcessRunner } from "@queqiao/process-runtime";
import { getWorkerCoreToolDefinitions } from "./core-tools.js";
import { createWorkerApp } from "./app.js";
import { WorkerCredentialSource } from "./worker-credential-source.js";
import { ReloadableExtensionHost } from "./reloadable-extension-host.js";
import { createWorkerProtocolService } from "./worker-protocol-service.js";
import { WorkerReverseSessionManager } from "./reverse-session-manager.js";

const configFile = requireRuntimeConfigFile();
const runtime = await readRuntimeConfig(configFile);
if (!runtime.worker) throw new Error("worker configuration is required");
const port = runtime.worker.listen.port;
if (runtime.workspaces.length < 1) throw new Error("Worker has no Workspace; run worker setup to configure one before serving");
const credentialFile = path.resolve(runtime.worker.tokenFile);
const credential = new WorkerCredentialSource(credentialFile);
await credential.current();
const extensionRuntime = new ReloadableExtensionHost(
  configFile,
  runtime.worker.environmentId,
  async (specifier) => import(specifier),
  getWorkerCoreToolDefinitions().map((tool) => tool.name),
);
await extensionRuntime.initialize();
const processes = new ProcessRunner();
const protocolService = await createWorkerProtocolService({
  ...(runtime.worker.workerId ? { workerId: runtime.worker.workerId } : {}),
  environmentId: runtime.worker.environmentId,
  workspacesFile: configFile,
  processes,
  extensionRuntime,
});
const reverseSessions = new WorkerReverseSessionManager({
  service: protocolService,
  credential,
  loadPersistent: async () => {
    const latest = await readRuntimeConfig(configFile);
    const reverse = latest.worker?.reverseSession;
    if (!reverse) return undefined;
    const caCertificate = await readFile(path.resolve(reverse.caCertificateFile), "utf8");
    return { target: reverse.target, caCertificate };
  },
});
const app = await createWorkerApp({
  ...(runtime.worker.workerId ? { workerId: runtime.worker.workerId } : {}),
  environmentId: runtime.worker.environmentId,
  workspacesFile: configFile,
  workerCredential: credential,
  processes,
  extensionRuntime,
  protocolService,
  reverseSessionControl: { activate: (input) => reverseSessions.activate(input) },
});
const server = app.listen(port, "127.0.0.1", () => {
  console.log(`Queqiao Worker listening on http://127.0.0.1:${port}`);
  void reverseSessions.startPersistent().catch((error) => console.error("Worker reverse-session startup failed", error));
});

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  reverseSessions.close();
  server.close(() => { void extensionRuntime.dispose().catch((error) => console.error("ExtensionHost shutdown failed", error)); });
  processes.shutdown();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
