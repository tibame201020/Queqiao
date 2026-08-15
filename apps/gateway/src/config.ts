import path from "node:path";
import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { runtimeConfigSchema, type InstalledExtensionConfig } from "@queqiao/config";

export type WorkerEndpointConfig = { environmentId: string; url: URL; token: string };
export type GatewayRuntimeConfig = { host?: "127.0.0.1"; port: number; managementPort: number; livenessIntervalMs?: number; publicBaseUrl: URL; resourceUrl: string; stateDir: string; approvalSecret: string; jwtSecret: Uint8Array; trustProxyHops: number; allowedRedirectOrigins: Set<string>; workers: readonly WorkerEndpointConfig[]; workersFile?: string; extensions: readonly InstalledExtensionConfig[]; configDirectory: string };
function required(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function secret(env: NodeJS.ProcessEnv, name: string): string { const file = env[`${name}_FILE`]?.trim(); return file ? readFileSync(path.resolve(file), "utf8").trim() : required(env, name); }
function integer(env: NodeJS.ProcessEnv, name: string, fallback: number): number { const value = Number(env[name] || fallback); if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`); return value; }
function livenessInterval(env: NodeJS.ProcessEnv): number { const value = integer(env, "QUEQIAO_LIVENESS_INTERVAL_MS", 30_000); if (value < 5_000 || value > 3_600_000) throw new Error("QUEQIAO_LIVENESS_INTERVAL_MS must be between 5000 and 3600000"); return value; }
function workerEndpoint(environmentId: string, rawUrl: string, token: string): WorkerEndpointConfig { const url = new URL(rawUrl); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error("Worker URL must be loopback HTTP without credentials, query, or fragment"); if (Buffer.byteLength(token) < 32) throw new Error("Worker token must be at least 32 bytes"); return { environmentId, url, token }; }
function normalizePublicBaseUrl(rawUrl: string, label: string): URL { const url = new URL(rawUrl); if (url.search || url.hash) throw new Error(`${label} cannot contain query or fragment`); if (url.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(url.hostname)) throw new Error(`${label} must use HTTPS except on localhost`); if (!url.pathname.endsWith("/")) url.pathname = `${url.pathname}/`; return url; }

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayRuntimeConfig {
  const publicBaseUrl = normalizePublicBaseUrl(required(env, "PUBLIC_BASE_URL"), "PUBLIC_BASE_URL");
  const signingSecret = secret(env, "JWT_SIGNING_SECRET"); if (Buffer.byteLength(signingSecret) < 32) throw new Error("JWT_SIGNING_SECRET must be at least 32 bytes");
  const workersFile = env.QUEQIAO_WORKERS_FILE?.trim();
  const workers = workersFile ? (JSON.parse(readFileSync(path.resolve(workersFile), "utf8")) as Array<{ environmentId: string; url: string; token?: string; tokenFile?: string }>).map((entry) => workerEndpoint(entry.environmentId, entry.url, entry.tokenFile ? readFileSync(path.resolve(entry.tokenFile), "utf8").trim() : entry.token || "")) : [workerEndpoint(env.QUEQIAO_ENVIRONMENT_ID?.trim() || "windows", env.QUEQIAO_WORKER_URL?.trim() || "http://127.0.0.1:7576", secret(env, "QUEQIAO_WORKER_TOKEN"))];
  if (!workers.length) throw new Error("At least one worker endpoint is required"); if (new Set(workers.map((entry) => entry.environmentId)).size !== workers.length) throw new Error("Worker environment IDs must be unique");
  return { host: "127.0.0.1", port: integer(env, "PORT", 7575), managementPort: integer(env, "QUEQIAO_MANAGEMENT_PORT", 7574), livenessIntervalMs: livenessInterval(env), publicBaseUrl, resourceUrl: new URL("mcp", publicBaseUrl).href, stateDir: path.resolve(required(env, "QUEQIAO_STATE_DIR")), approvalSecret: secret(env, "OAUTH_APPROVAL_SECRET"), jwtSecret: new TextEncoder().encode(signingSecret), trustProxyHops: integer(env, "TRUST_PROXY_HOPS", 1), allowedRedirectOrigins: new Set((env.OAUTH_ALLOWED_REDIRECT_ORIGINS || "https://chatgpt.com,http://127.0.0.1,http://localhost").split(",").map((item) => new URL(item.trim()).origin)), workers, ...(workersFile ? { workersFile: path.resolve(workersFile) } : {}), extensions: [], configDirectory: process.cwd() };
}

export function loadGatewayConfigFile(file: string): GatewayRuntimeConfig {
  const document = runtimeConfigSchema.parse(parse(readFileSync(path.resolve(file), "utf8")));
  if (!document.gateway) throw new Error("gateway configuration is required");
  const gateway = document.gateway;
  const publicBaseUrl = normalizePublicBaseUrl(gateway.publicBaseUrl, "gateway.publicBaseUrl");
  const signingSecret = readFileSync(path.resolve(gateway.jwtSigningSecretFile), "utf8").trim();
  const approvalSecret = readFileSync(path.resolve(gateway.approvalSecretFile), "utf8").trim();
  if (Buffer.byteLength(signingSecret) < 32) throw new Error("JWT signing secret must be at least 32 bytes");
  const workers = document.environments.map((entry) => workerEndpoint(entry.environmentId, entry.url, readFileSync(path.resolve(entry.tokenFile), "utf8").trim()));
  return { host: gateway.listen.host, port: gateway.listen.port, managementPort: gateway.managementListen.port, livenessIntervalMs: gateway.livenessIntervalMs, publicBaseUrl, resourceUrl: new URL("mcp", publicBaseUrl).href, stateDir: path.resolve(gateway.stateDirectory), approvalSecret, jwtSecret: new TextEncoder().encode(signingSecret), trustProxyHops: gateway.trustProxyHops, allowedRedirectOrigins: new Set(gateway.allowedRedirectOrigins.map((item) => new URL(item).origin)), workers, workersFile: path.resolve(file), extensions: document.extensions, configDirectory: path.dirname(path.resolve(file)) };
}
