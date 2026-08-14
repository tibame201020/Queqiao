import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { createGatewayApp } from "./app.js";
import { loadGatewayConfigFile } from "./config.js";
import { listenGateway } from "./listen.js";

const layout = resolveRuntimeLayout();
const config = loadGatewayConfigFile(process.env.QUEQIAO_CONFIG_FILE || layout.configFile);
const app = await createGatewayApp(config);
const host = config.host ?? "127.0.0.1";
listenGateway(app, config, () => { console.log(`Queqiao Gateway listening on http://${host}:${config.port}`); console.log(`Public MCP URL: ${config.resourceUrl}`); });
