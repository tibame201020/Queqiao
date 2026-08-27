import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { createGatewayApp } from "./app.js";
import { loadGatewayConfigFile } from "./config.js";
import { listenGateway } from "./listen.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import { MembershipWorkerRegistry } from "./worker-membership-registry.js";
import { EnrollmentService } from "./enrollment-service.js";
import { ensureGatewayManagementSecret } from "./management-secret.js";
import { createGatewayManagementApp } from "./management-app.js";
import { buildDeploymentManifest, doctorGateway, QUEQIAO_RUNTIME_SUPERVISOR_DEFAULT_PORT, type RuntimeLifecycleSnapshot } from "@queqiao/operations";
import { CORE_PUBLIC_TOOLS, QUEQIAO_CORE_MANIFEST_REVISION } from "@queqiao/core-manifest";
import { gatewayOperationsDiagnostics } from "./operations.js";
import { DashboardSessionBroker } from "./dashboard-session.js";
import { RuntimeSupervisorClient } from "./runtime-supervisor-client.js";

const layout = resolveRuntimeLayout();
const config = loadGatewayConfigFile(process.env.QUEQIAO_CONFIG_FILE || layout.configFile);
const memberships = new WorkerMembershipStore(config.stateDir);
const workerSource = new MembershipWorkerRegistry(memberships);
const enrollment = new EnrollmentService(memberships, config.stateDir);
const managementSecret = await ensureGatewayManagementSecret(config.stateDir);
const operations = gatewayOperationsDiagnostics(config.extensions);
const manifest = buildDeploymentManifest({ coreManifestRevision: QUEQIAO_CORE_MANIFEST_REVISION, coreTools: CORE_PUBLIC_TOOLS, extensions: config.extensions });
const app = await createGatewayApp(config, enrollment, workerSource);
const host = config.host ?? "127.0.0.1";
listenGateway(app, config, () => { console.log(`Queqiao Gateway listening on http://${host}:${config.port}`); console.log(`Public MCP URL: ${config.resourceUrl}`); });
const packagedDashboard = fileURLToPath(new URL("./dashboard/", import.meta.url));
const developmentDashboard = path.resolve(process.cwd(), "dist/dashboard");
const dashboardDirectory = existsSync(packagedDashboard) ? packagedDashboard : existsSync(developmentDashboard) ? developmentDashboard : undefined;
const dashboardSessions = new DashboardSessionBroker();
const supervisorPort = Number(process.env.QUEQIAO_SUPERVISOR_PORT || QUEQIAO_RUNTIME_SUPERVISOR_DEFAULT_PORT);
const supervisorClient = new RuntimeSupervisorClient({ port: supervisorPort, secretFile: path.join(layout.stateDir, "supervisor.secret") });
const runtimeLifecycle = async (): Promise<RuntimeLifecycleSnapshot> => {
  try {
    const membership = await memberships.read();
    const gatewayName = process.env.QUEQIAO_RUNTIME_NAME || "default";
    const targets = [{ role: "gateway" as const, name: gatewayName }, ...membership.workers.map((worker) => ({ role: "worker" as const, name: worker.environmentId }))];
    const runtimes = await Promise.all(targets.map((target) => supervisorClient.status(target.role, target.name)));
    return { apiVersion: 1, supervisor: { reachable: true }, runtimes };
  } catch {
    return { apiVersion: 1, supervisor: { reachable: false, error: "supervisor_unavailable" }, runtimes: [] };
  }
};
const managementApp = createGatewayManagementApp({ secret: managementSecret.secret, enrollment, memberships, workers: workerSource, stateDirectory: config.stateDir, operations, manifest, doctor: () => doctorGateway(config), dashboardSessions, runtimeLifecycle, ...(dashboardDirectory ? { dashboardDirectory } : {}) });
managementApp.listen(config.managementPort, "127.0.0.1", () => { console.log(`Queqiao Gateway management listening on http://127.0.0.1:${config.managementPort}`); if (dashboardDirectory) console.log(`Local Operations Dashboard: http://127.0.0.1:${config.managementPort}/dashboard/`); });
