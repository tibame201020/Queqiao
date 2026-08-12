import path from "node:path";
import { readFileSync } from "node:fs";

export type WorkerEndpointConfig = { environmentId: string; url: URL; token: string };
export type GatewayRuntimeConfig = { port: number; publicBaseUrl: URL; resourceUrl: string; stateDir: string; approvalSecret: string; jwtSecret: Uint8Array; trustProxyHops: number; allowedRedirectOrigins: Set<string>; workers: readonly WorkerEndpointConfig[]; workersFile?: string };
function required(env: NodeJS.ProcessEnv, name: string): string { const value = env[name]?.trim(); if (!value) throw new Error(`${name} is required`); return value; }
function integer(env: NodeJS.ProcessEnv, name: string, fallback: number): number { const value = Number(env[name] || fallback); if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`); return value; }
function workerEndpoint(environmentId: string, rawUrl: string, token: string): WorkerEndpointConfig { const url = new URL(rawUrl); if (url.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(url.hostname) || url.username || url.password || url.search || url.hash) throw new Error("Worker URL must be loopback HTTP without credentials, query, or fragment"); if (Buffer.byteLength(token) < 32) throw new Error("Worker token must be at least 32 bytes"); return { environmentId, url, token }; }

export function loadGatewayConfig(env: NodeJS.ProcessEnv = process.env): GatewayRuntimeConfig {
  const publicBaseUrl = new URL(required(env, "PUBLIC_BASE_URL"));
  publicBaseUrl.pathname = publicBaseUrl.pathname.replace(/\/$/, "");
  if (publicBaseUrl.search || publicBaseUrl.hash) throw new Error("PUBLIC_BASE_URL cannot contain query or fragment");
  if (publicBaseUrl.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(publicBaseUrl.hostname)) throw new Error("PUBLIC_BASE_URL must use HTTPS except on localhost");
  const signingSecret = required(env, "JWT_SIGNING_SECRET");
  if (Buffer.byteLength(signingSecret) < 32) throw new Error("JWT_SIGNING_SECRET must be at least 32 bytes");
  const workersFile = env.QUEQIAO_WORKERS_FILE?.trim();
  const workers: WorkerEndpointConfig[] = workersFile
    ? (JSON.parse(readFileSync(path.resolve(workersFile), "utf8")) as Array<{ environmentId: string; url: string; token: string }>).map((entry) => workerEndpoint(entry.environmentId, entry.url, entry.token))
    : [workerEndpoint(env.QUEQIAO_ENVIRONMENT_ID?.trim() || "windows", env.QUEQIAO_WORKER_URL?.trim() || "http://127.0.0.1:7576", required(env, "QUEQIAO_WORKER_TOKEN"))];
  if (!workers.length) throw new Error("At least one worker endpoint is required");
  if (new Set(workers.map((entry) => entry.environmentId)).size !== workers.length) throw new Error("Worker environment IDs must be unique");
  return { port: integer(env, "PORT", 7575), publicBaseUrl, resourceUrl: new URL("mcp", publicBaseUrl).href, stateDir: path.resolve(env.QUEQIAO_STATE_DIR?.trim() || path.join(process.cwd(), ".queqiao", "gateway")), approvalSecret: required(env, "OAUTH_APPROVAL_SECRET"), jwtSecret: new TextEncoder().encode(signingSecret), trustProxyHops: integer(env, "TRUST_PROXY_HOPS", 1), allowedRedirectOrigins: new Set((env.OAUTH_ALLOWED_REDIRECT_ORIGINS || "https://chatgpt.com,http://127.0.0.1,http://localhost").split(",").map((item) => new URL(item.trim()).origin)), workers, ...(workersFile ? { workersFile: path.resolve(workersFile) } : {}) };
}
