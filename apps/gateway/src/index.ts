import "dotenv/config";
import { createGatewayApp } from "./app.js";
import { loadGatewayConfig } from "./config.js";

const config = loadGatewayConfig();
const app = await createGatewayApp(config);
app.listen(config.port, "0.0.0.0", () => { console.log(`Queqiao Gateway listening on http://0.0.0.0:${config.port}`); console.log(`Public MCP URL: ${config.resourceUrl}`); });
