import { requireRuntimeConfigFile } from "@queqiao/platform-paths";
import { createGatewayApp } from "./app.js";
import { loadGatewayConfigFile } from "./config.js";
import { listenGateway } from "./listen.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import { EnrollmentService } from "./enrollment-service.js";
import { ensureGatewayManagementSecret } from "./management-secret.js";
import { createGatewayManagementApp } from "./management-app.js";
import { WorkerSessionRegistry } from "./worker-session-registry.js";
import { WorkerGrpcSessionServer } from "./grpc-worker-session-server.js";

const config = loadGatewayConfigFile(requireRuntimeConfigFile());
const memberships = new WorkerMembershipStore(config.stateDir);
const sessions = new WorkerSessionRegistry();
const enrollment = new EnrollmentService(memberships, config.stateDir, sessions);
const managementSecret = await ensureGatewayManagementSecret(config.stateDir);
const workerSessionServer = new WorkerGrpcSessionServer({ sessions, authenticate: (hello, credential) => enrollment.authenticateWorkerSession(hello, credential) });
const workerSessionTarget = config.workerSessionTls
  ? await workerSessionServer.listenTls(config.workerSessionHost, config.workerSessionPort, config.workerSessionTls.cert, config.workerSessionTls.key)
  : await workerSessionServer.listenLoopback(config.workerSessionPort);
console.log(`Queqiao Worker gRPC session listener: ${workerSessionTarget}${config.workerSessionTls ? " (TLS)" : " (loopback-only)"}`);
const app = await createGatewayApp(config, enrollment, sessions);
const host = config.host ?? "127.0.0.1";
listenGateway(app, config, () => { console.log(`Queqiao Gateway listening on http://${host}:${config.port}`); console.log(`Public MCP URL: ${config.resourceUrl}`); });
const managementApp = createGatewayManagementApp({ secret: managementSecret.secret, enrollment, memberships, stateDirectory: config.stateDir, sessions });
const managementServer = managementApp.listen(config.managementPort, "127.0.0.1", () => console.log(`Queqiao Gateway management listening on http://127.0.0.1:${config.managementPort}`));

let stopping = false;
const shutdown = () => {
  if (stopping) return;
  stopping = true;
  void workerSessionServer.close().catch((error) => console.error("Worker gRPC session shutdown failed", error));
  managementServer.close();
};
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);