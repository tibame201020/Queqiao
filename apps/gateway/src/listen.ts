import type { Express } from "express";
import type { Server } from "node:http";
import type { GatewayRuntimeConfig } from "./config.js";

export function listenGateway(app: Express, config: Pick<GatewayRuntimeConfig, "host" | "port">, onListening?: () => void): Server {
  const host = config.host ?? "127.0.0.1";
  return app.listen(config.port, host, onListening);
}
