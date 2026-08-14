import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { createGatewayApp } from "./app.js";
import { loadGatewayConfigFile } from "./config.js";
import { listenGateway } from "./listen.js";
import { WorkerMembershipStore } from "./worker-membership-store.js";
import { EnrollmentService } from "./enrollment-service.js";
import { ensureGatewayManagementSecret } from "./management-secret.js";
import { createGatewayManagementApp } from "./management-app.js";

const layout = resolveRuntimeLayout();
const config = loadGatewayConfigFile(process.env.QUEQIAO_CONFIG_FILE || layout.configFile);
const memberships = new WorkerMembershipStore(config.stateDir);
const enrollment = new EnrollmentService(memberships, config.stateDir);
const managementSecret = await ensureGatewayManagementSecret(config.stateDir);
const app = await createGatewayApp(config, enrollment);
const host = config.host ?? "127.0.0.1";
listenGateway(app, config, () => { console.log(`Queqiao Gateway listening on http://${host}:${config.port}`); console.log(`Public MCP URL: ${config.resourceUrl}`); });
const managementApp = createGatewayManagementApp({ secret: managementSecret.secret, enrollment, memberships, stateDirectory: config.stateDir });
managementApp.listen(config.managementPort, "127.0.0.1", () => console.log(`Queqiao Gateway management listening on http://127.0.0.1:${config.managementPort}`));
