import { access, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import path from "node:path";
import { runtimeConfigSchema, readRuntimeConfig, type RuntimeConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";
import { secureRuntimeDirectory, secureRuntimeFile } from "./secure-runtime-paths.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }

async function persistRuntimeConfig(configFile: string, next: RuntimeConfig): Promise<void> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  try { await store.initialize(next); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    await store.update(() => next);
  }
  await secureRuntimeFile(configFile);
}

async function readManagementSecret(stateDirectory: string): Promise<string> {
  const file = path.join(stateDirectory, "management.secret");
  const secret = (await readFile(file, "utf8")).trim();
  if (Buffer.byteLength(secret) < 32) throw new Error("Gateway management secret is unavailable; start or setup the Gateway first");
  return secret;
}

async function managementRequest(configFile: string, pathname: string, init: RequestInit = {}): Promise<Response> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.gateway) throw new Error("gateway configuration is required");
  const secret = await readManagementSecret(path.resolve(runtime.gateway.stateDirectory));
  const url = new URL(pathname, `http://${runtime.gateway.managementListen.host}:${runtime.gateway.managementListen.port}`);
  return fetch(url, { ...init, headers: { "content-type": "application/json", "x-queqiao-management-secret": secret, ...(init.headers || {}) }, signal: AbortSignal.timeout(5000) });
}

async function jsonOrThrow(response: Response): Promise<any> {
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${body?.error || "request_failed"}: ${body?.message || `HTTP ${response.status}`}`);
  return body;
}

export async function createJoinToken(configFile: string, args: string[]): Promise<unknown> {
  const expires = option(args, "expires");
  const response = await managementRequest(configFile, "/join-tokens", {
    method: "POST",
    body: JSON.stringify({ ...(expires ? { expiresSeconds: Number(expires) } : {}), ...(option(args, "worker-id") ? { workerId: option(args, "worker-id") } : {}), ...(option(args, "environment-id") ? { environmentId: option(args, "environment-id") } : {}) }),
  });
  return jsonOrThrow(response);
}

export async function listJoinedWorkers(configFile: string): Promise<unknown> {
  return jsonOrThrow(await managementRequest(configFile, "/workers"));
}

export async function updateJoinedWorkerTransport(configFile: string, workerId: string, endpointValue: string): Promise<unknown> {
  const endpoint = new URL(endpointValue);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("Worker endpoint must remain loopback HTTP in Security Baseline v2");
  return jsonOrThrow(await managementRequest(configFile, `/workers/${encodeURIComponent(workerId)}/transport`, { method: "PATCH", body: JSON.stringify({ transport: { type: "http", endpoint: endpoint.href } }) }));
}

export async function removeJoinedWorker(configFile: string, workerId: string): Promise<unknown> {
  return jsonOrThrow(await managementRequest(configFile, `/workers/${encodeURIComponent(workerId)}`, { method: "DELETE" }));
}

type JoinMarker = { version: 1; tokenFile: string; backupFile?: string };

async function markerFile(tokenFile: string): Promise<string> { return `${tokenFile}.join-provisional.json`; }

async function recoverStaleJoin(tokenFile: string): Promise<void> {
  const marker = await markerFile(tokenFile);
  try {
    const parsed = JSON.parse(await readFile(marker, "utf8")) as JoinMarker;
    if (path.resolve(parsed.tokenFile) !== path.resolve(tokenFile)) throw new Error("Stale join marker does not match Worker credential path");
    await rm(tokenFile, { force: true });
    if (parsed.backupFile) {
      if (path.dirname(path.resolve(parsed.backupFile)) !== path.dirname(path.resolve(tokenFile))) throw new Error("Stale join backup escaped Worker credential directory");
      await rename(parsed.backupFile, tokenFile);
      await secureRuntimeFile(tokenFile);
    }
    await rm(marker, { force: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

async function installProvisionalCredential(tokenFile: string, credential: string): Promise<{ marker: string; backupFile?: string }> {
  await secureRuntimeDirectory(path.dirname(tokenFile));
  await recoverStaleJoin(tokenFile);
  const marker = await markerFile(tokenFile);
  const temporary = `${tokenFile}.join-${process.pid}-${Date.now()}.tmp`;
  await writeFile(temporary, `${credential}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await secureRuntimeFile(temporary);
  let backupFile: string | undefined;
  try {
    await access(tokenFile);
    backupFile = `${tokenFile}.prejoin-${Date.now()}`;
  } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const markerValue: JoinMarker = { version: 1, tokenFile, ...(backupFile ? { backupFile } : {}) };
  const handle = await open(marker, "wx", 0o600);
  try { await handle.writeFile(`${JSON.stringify(markerValue)}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
  await secureRuntimeFile(marker);
  try {
    if (backupFile) await rename(tokenFile, backupFile);
    await rename(temporary, tokenFile);
    await secureRuntimeFile(tokenFile);
    return { marker, ...(backupFile ? { backupFile } : {}) };
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined);
    if (backupFile) await rename(backupFile, tokenFile).catch(() => undefined);
    await rm(marker, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function rollbackProvisional(tokenFile: string, state: { marker: string; backupFile?: string }): Promise<void> {
  await rm(tokenFile, { force: true }).catch(() => undefined);
  if (state.backupFile) {
    await rename(state.backupFile, tokenFile).catch(() => undefined);
    await secureRuntimeFile(tokenFile).catch(() => undefined);
  }
  await rm(state.marker, { force: true }).catch(() => undefined);
}

async function commitProvisional(state: { marker: string; backupFile?: string }): Promise<void> {
  if (state.backupFile) await rm(state.backupFile, { force: true });
  await rm(state.marker, { force: true });
}

export async function joinWorker(configFile: string, args: string[]): Promise<unknown> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker) throw new Error("worker configuration is required");
  if (!runtime.worker.workerId) throw new Error("Worker has no stable workerId; run worker setup or migrate the Worker identity first");
  const joinToken = requiredOption(args, "token");
  const gateway = new URL(requiredOption(args, "gateway"));
  const endpoint = new URL(option(args, "endpoint") || `http://127.0.0.1:${runtime.worker.listen.port}/`);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("Worker endpoint must remain loopback HTTP in Security Baseline v2");
  const tokenFile = path.resolve(runtime.worker.tokenFile);
  await recoverStaleJoin(tokenFile);
  const start = await jsonOrThrow(await fetch(new URL("enrollment/join/start", gateway), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: joinToken, workerId: runtime.worker.workerId, environmentId: runtime.worker.environmentId, transport: { type: "http", endpoint: endpoint.href } }),
    signal: AbortSignal.timeout(5000),
  }));
  const transactionId = String(start.transactionId || "");
  const credential = String(start.credential || "");
  if (!transactionId || Buffer.byteLength(credential) < 32) throw new Error("Gateway returned an invalid provisional enrollment response");
  const state = await installProvisionalCredential(tokenFile, credential);
  try {
    const confirmed = await jsonOrThrow(await fetch(new URL("enrollment/join/confirm", gateway), {
      method: "POST",
      headers: { "content-type": "application/json", "x-queqiao-worker-token": credential },
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(15_000),
    }));
    await commitProvisional(state);
    return confirmed;
  } catch (error) {
    await rollbackProvisional(tokenFile, state);
    throw error;
  }
}

export async function setupGateway(configFile: string, args: string[], stateDirectoryDefault: string, secretsDirectory: string): Promise<unknown> {
  const publicBaseUrl = new URL(requiredOption(args, "public-base-url"));
  await secureRuntimeDirectory(path.dirname(configFile));
  await secureRuntimeDirectory(stateDirectoryDefault);
  await secureRuntimeDirectory(secretsDirectory);
  let current: any = { version: 1, workspaces: [] };
  try { current = await readRuntimeConfig(configFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (current.gateway) throw new Error("Gateway is already setup in this configuration");
  const createSecret = async (name: string, bytes: number) => {
    const file = path.join(secretsDirectory, `${name}.secret`);
    await writeFile(file, `${randomBytes(bytes).toString("base64url")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
    await secureRuntimeFile(file);
    return file;
  };
  const approvalSecretFile = await createSecret("oauth-approval", 24);
  const jwtSigningSecretFile = await createSecret("jwt-signing", 48);
  const managementSecretFile = path.join(stateDirectoryDefault, "management.secret");
  await writeFile(managementSecretFile, `${randomBytes(32).toString("base64url")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await secureRuntimeFile(managementSecretFile);
  const next = runtimeConfigSchema.parse({ ...current, gateway: { publicBaseUrl: publicBaseUrl.href, listen: { host: "127.0.0.1", port: Number(option(args, "port") || 7575) }, managementListen: { host: "127.0.0.1", port: Number(option(args, "management-port") || 7574) }, trustProxyHops: 1, stateDirectory: stateDirectoryDefault, approvalSecretFile, jwtSigningSecretFile } });
  await persistRuntimeConfig(configFile, next);
  return { setup: true, role: "gateway", file: configFile };
}

export async function setupWorker(configFile: string, args: string[], secretsDirectory: string): Promise<unknown> {
  await secureRuntimeDirectory(path.dirname(configFile));
  await secureRuntimeDirectory(secretsDirectory);
  let current: any = { version: 1, workspaces: [] };
  try { current = await readRuntimeConfig(configFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (current.worker) throw new Error("Worker is already setup in this configuration");
  const environmentId = option(args, "environment-id") || (process.platform === "win32" ? "windows" : "linux");
  const defaultWorkspaceId = requiredOption(args, "workspace-id");
  const root = await resolveWorkspaceAuthorityRoot(requiredOption(args, "workspace-root"));
  const tokenFile = path.join(secretsDirectory, `worker-${environmentId}.secret`);
  await writeFile(tokenFile, `${randomBytes(32).toString("base64url")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await secureRuntimeFile(tokenFile);
  const workspace = { id: defaultWorkspaceId, displayName: defaultWorkspaceId, root, profile: "read-only", tools: { allow: [], deny: [], explicit: [] }, commands: { allow: [] } };
  const next = runtimeConfigSchema.parse({ ...current, worker: { workerId: randomUUID(), environmentId, listen: { host: "127.0.0.1", port: Number(option(args, "port") || 7576) }, tokenFile, defaultWorkspaceId }, workspaces: current.workspaces?.some((entry: any) => entry.id === defaultWorkspaceId) ? current.workspaces : [...(current.workspaces || []), workspace] });
  await persistRuntimeConfig(configFile, next);
  return { setup: true, role: "worker", file: configFile, workerId: next.worker?.workerId, environmentId };
}
