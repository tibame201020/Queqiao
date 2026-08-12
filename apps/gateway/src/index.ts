import { resolveRuntimeLayout } from "@queqiao/platform-paths";
import { createGatewayApp } from "./app.js";
import { loadGatewayConfigFile } from "./config.js";

const layout = resolveRuntimeLayout();
const config = loadGatewayConfigFile(process.env.QUEQIAO_CONFIG_FILE || layout.configFile);
const app = await createGatewayApp(config);
app.listen(config.port, "0.0.0.0", () => { console.log(`Queqiao Gateway listening on http://0.0.0.0:${config.port}`); console.log(`Public MCP URL: ${config.resourceUrl}`); });
