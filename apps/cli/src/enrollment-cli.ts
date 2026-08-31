import { access, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { isIP } from "node:net";
import selfsigned from "selfsigned";
import { cancel, intro, isCancel, outro, password, text } from "@clack/prompts";
import { runtimeConfigSchema, readRuntimeConfig, readRuntimeConfigForRepair, workspaceConfigSchema, type RuntimeConfig, type WorkspaceConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { resolveWorkspaceAuthorityRoot, workspaceRootsEqual } from "./workspace-authority.js";
import { uniqueWorkspaceId } from "./workspace-cli.js";
import { secureRuntimeDirectory, secureRuntimeFile } from "./secure-runtime-paths.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
function assertAllowedOptions(args: string[], command: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed.map((name) => `--${name}`));
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    if (!allowedSet.has(arg)) throw new Error(`Unknown option "${arg}" for "${command}"`);
  }
}
export type JoinPrompt = (field: "code", message: string) => Promise<string>;
export type WorkerSetupPrompt = (field: "port", message: string, initialValue: string) => Promise<string>;
export type WorkerSetupOptions = { initialWorkspace?: WorkspaceConfig };
export type GatewaySetupPrompt = (field: "public-base-url", message: string, initialValue?: string) => Promise<string>;

type JoinCodeEnvelope = {
  v: 1;
  gateway: string;
  token: string;
  expiresAt?: string;
  workerSession?: { target: string; caCertificate: string };
};

const JOIN_CODE_PREFIX = "qjq1:";

function formatWorkerSessionTarget(host: string, port: number): string {
  return isIP(host) === 6 ? `[${host}]:${port}` : `${host}:${port}`;
}

function validateWorkerSessionJoin(workerSession: JoinCodeEnvelope["workerSession"]): void {
  if (!workerSession) return;
  let url: URL;
  try { url = new URL(`https://${workerSession.target}`); }
  catch { throw new Error("Invalid Worker session target"); }
  if (!url.hostname || !url.port || url.username || url.password || url.pathname !== "/") throw new Error("Invalid Worker session target");
  if (!workerSession.caCertificate.includes("-----BEGIN CERTIFICATE-----") || !workerSession.caCertificate.includes("-----END CERTIFICATE-----") || Buffer.byteLength(workerSession.caCertificate) > 32_768) {
    throw new Error("Invalid Worker session CA certificate");
  }
}

export function encodeJoinCode(envelope: JoinCodeEnvelope): string {
  const gatewayError = validateGatewayUrl(envelope.gateway);
  if (gatewayError) throw new Error(gatewayError);
  if (!envelope.token.trim()) throw new Error("Join token is required");
  validateWorkerSessionJoin(envelope.workerSession);
  return `${JOIN_CODE_PREFIX}${Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")}`;
}

export function decodeJoinCode(value: string): JoinCodeEnvelope {
  const trimmed = value.trim();
  if (!trimmed.startsWith(JOIN_CODE_PREFIX)) throw new Error("Invalid join code");
  try {
    const parsed = JSON.parse(Buffer.from(trimmed.slice(JOIN_CODE_PREFIX.length), "base64url").toString("utf8")) as Partial<JoinCodeEnvelope>;
    if (parsed.v !== 1 || typeof parsed.gateway !== "string" || typeof parsed.token !== "string") throw new Error("Invalid join code");
    const gatewayError = validateGatewayUrl(parsed.gateway);
    if (gatewayError || !parsed.token.trim()) throw new Error("Invalid join code");
    validateWorkerSessionJoin(parsed.workerSession);
    return { v: 1, gateway: new URL(parsed.gateway).href, token: parsed.token, ...(typeof parsed.expiresAt === "string" ? { expiresAt: parsed.expiresAt } : {}), ...(parsed.workerSession ? { workerSession: parsed.workerSession } : {}) };
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid join code") throw error;
    throw new Error("Invalid join code");
  }
}

function assertPromptNotCancelled<T>(value: T | symbol, message: string): T {
  if (!isCancel(value)) return value as T;
  cancel(message);
  throw new Error(message);
}

function validateGatewayUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? undefined : "Gateway URL must use http or https";
  } catch {
    return "Enter a valid Gateway URL";
  }
}

function validatePort(value: string): string | undefined {
  const port = Number(value);
  return Number.isInteger(port) && port >= 1 && port <= 65535 ? undefined : "Worker port must be an integer from 1 to 65535";
}

async function resolveJoinInputs(args: string[], prompt?: JoinPrompt): Promise<{ gateway: string; token: string; workerSession?: { target: string; caCertificate: string }; interactive: boolean }> {
  const codeArg = option(args, "join-code");
  if (codeArg) {
    const decoded = decodeJoinCode(codeArg);
    return { gateway: decoded.gateway, token: decoded.token, ...(decoded.workerSession ? { workerSession: decoded.workerSession } : {}), interactive: false };
  }

  if (prompt) {
    const code = (await prompt("code", "Join code")).trim();
    if (!code) throw new Error("Join code is required");
    const decoded = decodeJoinCode(code);
    return { gateway: decoded.gateway, token: decoded.token, ...(decoded.workerSession ? { workerSession: decoded.workerSession } : {}), interactive: true };
  }

  intro("Join Worker");
  const code = String(assertPromptNotCancelled(await password({
    message: "Join code",
    validate: (value) => {
      if (!value?.trim()) return "Join code is required";
      try { decodeJoinCode(value); return undefined; } catch { return "Invalid join code"; }
    },
  }), "Worker join cancelled")).trim();
  const decoded = decodeJoinCode(code);
  return { gateway: decoded.gateway, token: decoded.token, ...(decoded.workerSession ? { workerSession: decoded.workerSession } : {}), interactive: true };
}

async function persistRuntimeConfig(configFile: string, next: RuntimeConfig, replaceExisting = false): Promise<void> {
  const store = new AtomicConfigStore<RuntimeConfig>(configFile, (value) => runtimeConfigSchema.parse(value));
  try { await store.initialize(next); } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if (replaceExisting) await store.replace(next);
    else await store.update(() => next);
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

export type ClipboardWriter = (value: string) => Promise<void>;

type ClipboardCommand = { command: string; args: string[] };

function clipboardCommands(): ClipboardCommand[] {
  if (process.platform === "win32") return [{ command: "clip.exe", args: [] }];
  if (process.platform === "darwin") return [{ command: "pbcopy", args: [] }];
  return [
    { command: "wl-copy", args: [] },
    { command: "xclip", args: ["-selection", "clipboard"] },
    { command: "xsel", args: ["--clipboard", "--input"] },
    { command: "clip.exe", args: [] },
  ];
}

async function runClipboardCommand(candidate: ClipboardCommand, value: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(candidate.command, candidate.args, { stdio: ["pipe", "ignore", "pipe"] });
    let stderr = "";
    child.stderr?.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", reject);
    child.once("close", (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `${candidate.command} exited with code ${code}`)));
    child.stdin?.end(value);
  });
}

export async function copyTextToClipboard(value: string, writer?: ClipboardWriter): Promise<void> {
  if (writer) return writer(value);
  let lastError: unknown;
  for (const candidate of clipboardCommands()) {
    try {
      await runClipboardCommand(candidate, value);
      return;
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`Clipboard copy is unavailable${lastError instanceof Error ? `: ${lastError.message}` : ""}`);
}

export async function createJoinToken(configFile: string, args: string[], clipboardWriter?: ClipboardWriter): Promise<unknown> {
  assertAllowedOptions(args, "queqiao gateway join-token", ["gateway", "expires", "json"]);
  const expires = option(args, "expires");
  const response = await managementRequest(configFile, "/join-tokens", {
    method: "POST",
    body: JSON.stringify({ ...(expires ? { expiresSeconds: Number(expires) } : {}) }),
  });
  const result = await jsonOrThrow(response);
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.gateway) throw new Error("gateway configuration is required");
  let workerSession: JoinCodeEnvelope["workerSession"];
  if (runtime.gateway.workerSessionListen?.host === "0.0.0.0") {
    const advertiseHost = runtime.gateway.workerSessionAdvertiseHost;
    const tls = runtime.gateway.workerSessionTls;
    if (!advertiseHost || !tls) throw new Error("Remote Worker session configuration is incomplete");
    const caCertificate = await readFile(path.resolve(tls.certFile), "utf8");
    workerSession = { target: formatWorkerSessionTarget(advertiseHost, runtime.gateway.workerSessionListen.port), caCertificate };
  }
  const joinCode = encodeJoinCode({
    v: 1,
    gateway: runtime.gateway.publicBaseUrl,
    token: String(result.token || ""),
    ...(typeof result.expiresAt === "string" ? { expiresAt: result.expiresAt } : {}),
    ...(workerSession ? { workerSession } : {}),
  });
  const safeResult = { expiresAt: result.expiresAt, bindings: result.bindings, joinCodeVersion: 1 };
  if (args.includes("--json")) return { ...safeResult, joinCode };
  try {
    await copyTextToClipboard(joinCode, clipboardWriter);
    return { ...safeResult, copied: true };
  } catch (error) {
    return { ...safeResult, copied: false, joinCode, copyError: error instanceof Error ? error.message : String(error) };
  }
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

async function preflightLocalWorker(endpoint: URL, worker: { workerId: string; environmentId: string }, tokenFile: string, workerName: string): Promise<void> {
  let currentCredential: string;
  try { currentCredential = (await readFile(tokenFile, "utf8")).trim(); } catch { throw new Error(`Worker credential is unavailable for ${workerName}; run worker setup first`); }
  if (Buffer.byteLength(currentCredential) < 32) throw new Error(`Worker credential is invalid for ${workerName}; run worker setup first`);
  try {
    const health = await fetch(new URL("health", endpoint), { signal: AbortSignal.timeout(3000) });
    if (!health.ok) throw new Error(`health returned HTTP ${health.status}`);
    const identityResponse = await fetch(new URL("enrollment/identity", endpoint), { headers: { "x-queqiao-worker-token": currentCredential }, signal: AbortSignal.timeout(3000) });
    if (!identityResponse.ok) throw new Error(`identity returned HTTP ${identityResponse.status}`);
    const identity = await identityResponse.json() as { workerId?: unknown; environmentId?: unknown };
    if (identity.workerId !== worker.workerId || identity.environmentId !== worker.environmentId) throw new Error("Worker identity does not match the named Worker configuration");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Worker ${workerName} is not ready for enrollment (${detail}). Start it first: queqiao worker serve --bg --worker ${workerName}`);
  }
}

async function activateLocalReverseSession(endpoint: URL, credential: string, workerSession: NonNullable<JoinCodeEnvelope["workerSession"]>): Promise<void> {
  const response = await fetch(new URL("enrollment/reverse-session/connect", endpoint), {
    method: "POST",
    headers: { "content-type": "application/json", "x-queqiao-worker-token": credential },
    body: JSON.stringify(workerSession),
    signal: AbortSignal.timeout(10_000),
  });
  await jsonOrThrow(response);
}

async function persistWorkerReverseSession(
  configFile: string,
  workerId: string,
  tokenFile: string,
  workerSession: NonNullable<JoinCodeEnvelope["workerSession"]>,
): Promise<void> {
  const directory = path.dirname(tokenFile);
  await secureRuntimeDirectory(directory);
  const caCertificateFile = path.join(directory, `worker-session-${workerId}-${randomUUID()}.crt`);
  await writeFile(caCertificateFile, workerSession.caCertificate, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await secureRuntimeFile(caCertificateFile);
  let previousCaFile: string | undefined;
  try {
    const latest = await readRuntimeConfig(configFile);
    if (!latest.worker || latest.worker.workerId !== workerId) throw new Error("Worker identity changed while persisting reverse session");
    previousCaFile = latest.worker.reverseSession?.caCertificateFile;
    const next = runtimeConfigSchema.parse({
      ...latest,
      worker: { ...latest.worker, reverseSession: { target: workerSession.target, caCertificateFile } },
    });
    await persistRuntimeConfig(configFile, next);
  } catch (error) {
    await rm(caCertificateFile, { force: true }).catch(() => undefined);
    throw error;
  }
  if (previousCaFile && path.resolve(previousCaFile) !== path.resolve(caCertificateFile)) {
    await rm(previousCaFile, { force: true }).catch(() => undefined);
  }
}

export async function joinWorker(configFile: string, args: string[], prompt?: JoinPrompt): Promise<unknown> {
  assertAllowedOptions(args, "queqiao worker join", ["worker", "join-code", "json"]);
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker) throw new Error("worker configuration is required");
  if (!runtime.worker.workerId) throw new Error("Worker has no stable workerId; run worker setup or migrate the Worker identity first");
  const endpoint = new URL(`http://127.0.0.1:${runtime.worker.listen.port}/`);
  if (endpoint.protocol !== "http:" || !["127.0.0.1", "localhost", "::1"].includes(endpoint.hostname)) throw new Error("Worker endpoint must remain loopback HTTP in Security Baseline v2");
  const tokenFile = path.resolve(runtime.worker.tokenFile);
  await recoverStaleJoin(tokenFile);
  const workerName = option(args, "worker") || runtime.worker.environmentId;
  await preflightLocalWorker(endpoint, { workerId: runtime.worker.workerId, environmentId: runtime.worker.environmentId }, tokenFile, workerName);
  const inputs = await resolveJoinInputs(args, prompt);
  const joinToken = inputs.token;
  const gateway = new URL(inputs.gateway);
  const start = await jsonOrThrow(await fetch(new URL("enrollment/join/start", gateway), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      token: joinToken,
      workerId: runtime.worker.workerId,
      environmentId: runtime.worker.environmentId,
      transport: inputs.workerSession ? { type: "grpc", mode: "reverse" } : { type: "http", endpoint: endpoint.href },
    }),
    signal: AbortSignal.timeout(5000),
  }));
  const transactionId = String(start.transactionId || "");
  const credential = String(start.credential || "");
  if (!transactionId || Buffer.byteLength(credential) < 32) throw new Error("Gateway returned an invalid provisional enrollment response");
  const state = await installProvisionalCredential(tokenFile, credential);
  let gatewayCommitted = false;
  try {
    if (inputs.workerSession) await activateLocalReverseSession(endpoint, credential, inputs.workerSession);
    const confirmed = await jsonOrThrow(await fetch(new URL("enrollment/join/confirm", gateway), {
      method: "POST",
      headers: { "content-type": "application/json", "x-queqiao-worker-token": credential },
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(15_000),
    }));
    gatewayCommitted = true;
    if (inputs.workerSession) await persistWorkerReverseSession(configFile, runtime.worker.workerId, tokenFile, inputs.workerSession);
    await commitProvisional(state);
    if (inputs.interactive && !prompt) outro(`Worker joined: ${runtime.worker.environmentId}`);
    return confirmed;
  } catch (error) {
    if (gatewayCommitted) await commitProvisional(state).catch(() => undefined);
    else await rollbackProvisional(tokenFile, state);
    throw error;
  }
}

async function generateWorkerSessionTls(secretsDirectory: string, advertiseHost: string): Promise<{ certFile: string; keyFile: string }> {
  const altNames = isIP(advertiseHost)
    ? [{ type: 7 as const, ip: advertiseHost }]
    : [{ type: 2 as const, value: advertiseHost }];
  const pems = await selfsigned.generate([{ name: "commonName", value: advertiseHost }], {
    keyType: "ec",
    curve: "P-256",
    algorithm: "sha256",
    notBeforeDate: new Date(Date.now() - 60_000),
    notAfterDate: new Date(Date.now() + 5 * 365 * 24 * 60 * 60 * 1000),
    extensions: [
      { name: "basicConstraints", cA: true },
      { name: "keyUsage", keyCertSign: true, digitalSignature: true, keyEncipherment: true },
      { name: "extKeyUsage", serverAuth: true },
      { name: "subjectAltName", altNames },
    ],
  });
  const suffix = randomUUID();
  const certFile = path.join(secretsDirectory, `worker-session-${suffix}.crt`);
  const keyFile = path.join(secretsDirectory, `worker-session-${suffix}.key`);
  await writeFile(certFile, pems.cert, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await writeFile(keyFile, pems.private, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await secureRuntimeFile(certFile);
  await secureRuntimeFile(keyFile);
  return { certFile, keyFile };
}

export async function setupGateway(configFile: string, args: string[], stateDirectoryDefault: string, secretsDirectory: string, prompt?: GatewaySetupPrompt): Promise<unknown> {
  assertAllowedOptions(args, "queqiao gateway setup", ["public-base-url", "port", "management-port", "worker-session-host", "worker-session-port"]);
  let current: any = { version: 1, workspaces: [] };
  try { current = await readRuntimeConfig(configFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const existingGateway = current.gateway;
  let publicBaseUrlValue = option(args, "public-base-url");
  if (!publicBaseUrlValue) {
    const initialValue = existingGateway?.publicBaseUrl;
    if (prompt) {
      publicBaseUrlValue = (await prompt("public-base-url", "Public Gateway URL", initialValue)).trim() || initialValue;
    } else if (process.stdin.isTTY && process.stdout.isTTY) {
      intro("Gateway Setup");
      const answer = await text({
        message: "Public Gateway URL",
        ...(initialValue ? { placeholder: initialValue, defaultValue: initialValue } : { placeholder: "https://your-gateway.example/" }),
        validate: (value) => {
          const candidate = value?.trim() || initialValue;
          if (!candidate) return "Public Gateway URL is required";
          try {
            const parsed = new URL(candidate);
            return parsed.protocol === "http:" || parsed.protocol === "https:" ? undefined : "URL must use http or https";
          } catch {
            return "Enter a valid URL";
          }
        },
      });
      if (isCancel(answer)) {
        cancel("Gateway setup cancelled");
        throw new Error("Gateway setup cancelled");
      }
      publicBaseUrlValue = String(answer || initialValue || "").trim();
    } else {
      throw new Error("Public Gateway URL is required in non-interactive mode. Use --public-base-url <url>.");
    }
  }
  if (!publicBaseUrlValue) throw new Error("Public Gateway URL is required");
  const publicBaseUrl = new URL(publicBaseUrlValue);
  if (publicBaseUrl.protocol !== "http:" && publicBaseUrl.protocol !== "https:") throw new Error("Public Gateway URL must use http or https");

  await secureRuntimeDirectory(path.dirname(configFile));
  await secureRuntimeDirectory(stateDirectoryDefault);
  await secureRuntimeDirectory(secretsDirectory);

  const gatewayPort = Number(option(args, "port") || existingGateway?.listen?.port || 7575);
  const managementPort = Number(option(args, "management-port") || existingGateway?.managementListen?.port || 7574);
  const requestedWorkerSessionHost = option(args, "worker-session-host")?.trim();
  const requestedWorkerSessionPort = option(args, "worker-session-port");
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error("Gateway port must be between 1 and 65535");
  if (!Number.isInteger(managementPort) || managementPort < 1 || managementPort > 65535) throw new Error("Management port must be between 1 and 65535");
  if (gatewayPort === managementPort) throw new Error("Gateway and Management ports must be different");
  if (requestedWorkerSessionHost && (requestedWorkerSessionHost.includes("://") || requestedWorkerSessionHost.includes("/") || /\s/.test(requestedWorkerSessionHost))) {
    throw new Error("Worker session host must be a DNS name or IP address without a scheme or path");
  }

  const existingRemoteHost = existingGateway?.workerSessionAdvertiseHost as string | undefined;
  const effectiveRemoteHost = requestedWorkerSessionHost || existingRemoteHost;
  const remoteEnabled = Boolean(effectiveRemoteHost && (requestedWorkerSessionHost || existingGateway?.workerSessionListen?.host === "0.0.0.0"));
  if (requestedWorkerSessionPort && !remoteEnabled) throw new Error("--worker-session-port requires --worker-session-host or an existing remote Worker session listener");

  let workerSessionPatch: Record<string, unknown> = {};
  let obsoleteTls: { certFile?: string; keyFile?: string } | undefined;
  if (remoteEnabled && effectiveRemoteHost) {
    const workerSessionPort = Number(requestedWorkerSessionPort || existingGateway?.workerSessionListen?.port || gatewayPort - 2);
    if (!Number.isInteger(workerSessionPort) || workerSessionPort < 1 || workerSessionPort > 65535) throw new Error("Worker session port must be between 1 and 65535");
    if (workerSessionPort === gatewayPort || workerSessionPort === managementPort) throw new Error("Worker session port must be different from Gateway and Management ports");
    let tls = existingGateway?.workerSessionTls as { certFile: string; keyFile: string } | undefined;
    if (!tls || (requestedWorkerSessionHost && requestedWorkerSessionHost !== existingRemoteHost)) {
      const generated = await generateWorkerSessionTls(secretsDirectory, effectiveRemoteHost);
      obsoleteTls = tls;
      tls = generated;
    }
    workerSessionPatch = {
      workerSessionListen: { host: "0.0.0.0", port: workerSessionPort },
      workerSessionAdvertiseHost: effectiveRemoteHost,
      workerSessionTls: tls,
    };
  }

  if (existingGateway) {
    const next = runtimeConfigSchema.parse({
      ...current,
      gateway: {
        ...existingGateway,
        publicBaseUrl: publicBaseUrl.href,
        listen: { ...existingGateway.listen, port: gatewayPort },
        managementListen: { ...existingGateway.managementListen, port: managementPort },
        ...workerSessionPatch,
      },
    });
    await persistRuntimeConfig(configFile, next);
    if (obsoleteTls) {
      if (obsoleteTls.certFile) await rm(obsoleteTls.certFile, { force: true }).catch(() => undefined);
      if (obsoleteTls.keyFile) await rm(obsoleteTls.keyFile, { force: true }).catch(() => undefined);
    }
    return { setup: true, mode: "edit", role: "gateway", file: configFile };
  }

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
  const next = runtimeConfigSchema.parse({
    ...current,
    gateway: {
      publicBaseUrl: publicBaseUrl.href,
      listen: { host: "127.0.0.1", port: gatewayPort },
      managementListen: { host: "127.0.0.1", port: managementPort },
      trustProxyHops: 1,
      stateDirectory: stateDirectoryDefault,
      approvalSecretFile,
      jwtSigningSecretFile,
      ...workerSessionPatch,
    },
  });
  await persistRuntimeConfig(configFile, next);
  return { setup: true, mode: "create", role: "gateway", file: configFile };
}
export async function updateWorkerPort(configFile: string, args: string[], prompt?: WorkerSetupPrompt): Promise<unknown> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker) throw new Error("worker configuration is required");
  const portArg = option(args, "port");
  let portValue = portArg;
  if (!portValue) {
    const currentPort = String(runtime.worker.listen.port);
    if (prompt) {
      portValue = (await prompt("port", "Worker port", currentPort)).trim() || currentPort;
    } else {
      intro("Worker Port");
      portValue = String(assertPromptNotCancelled(await text({
        message: "Port",
        placeholder: currentPort,
        defaultValue: currentPort,
        validate: (value) => validatePort(value || currentPort),
      }), "Worker port update cancelled")).trim() || currentPort;
    }
  }
  const portError = validatePort(portValue);
  if (portError) throw new Error(portError);
  const port = Number(portValue);
  const next = runtimeConfigSchema.parse({ ...runtime, worker: { ...runtime.worker, listen: { ...runtime.worker.listen, port } } });
  await persistRuntimeConfig(configFile, next);
  if (!portArg && !prompt) outro(`Worker port updated: ${port}`);
  return { changed: port !== runtime.worker.listen.port, role: "worker", workerId: runtime.worker.workerId, environmentId: runtime.worker.environmentId, previousPort: runtime.worker.listen.port, port };
}

export async function setupWorker(configFile: string, args: string[], secretsDirectory: string, prompt?: WorkerSetupPrompt, options: WorkerSetupOptions = {}): Promise<unknown> {
  let current: any = { version: 1, workspaces: [] };
  try { current = await readRuntimeConfigForRepair(configFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const existingWorker = current.worker;
  await secureRuntimeDirectory(path.dirname(configFile));
  await secureRuntimeDirectory(secretsDirectory);
  const environmentId = existingWorker?.environmentId || option(args, "environment-id") || (process.platform === "win32" ? "windows" : "linux");
  const portArg = option(args, "port");
  const initialPort = String(existingWorker?.listen.port || 7576);
  let portValue = portArg;
  if (!portValue) {
    if (prompt) {
      portValue = (await prompt("port", "Worker port", initialPort)).trim() || initialPort;
    } else {
      intro("Worker Setup");
      portValue = String(assertPromptNotCancelled(await text({
        message: "Port",
        placeholder: initialPort,
        defaultValue: initialPort,
        validate: (value) => validatePort(value || initialPort),
      }), "Worker setup cancelled")).trim() || initialPort;
    }
  }
  const portError = validatePort(portValue);
  if (portError) throw new Error(portError);
  const port = Number(portValue);

  const currentWorkspaces = Array.isArray(current.workspaces) ? current.workspaces : [];
  const parsedInitialWorkspace = options.initialWorkspace ? workspaceConfigSchema.parse(options.initialWorkspace) : undefined;
  let initialWorkspace: WorkspaceConfig | undefined;
  if (parsedInitialWorkspace) {
    const root = await resolveWorkspaceAuthorityRoot(parsedInitialWorkspace.root);
    if (currentWorkspaces.some((entry: WorkspaceConfig) => workspaceRootsEqual(entry.root, root))) {
      throw new Error(`Workspace path is already authorized: ${root}`);
    }
    initialWorkspace = workspaceConfigSchema.parse({
      ...parsedInitialWorkspace,
      id: uniqueWorkspaceId(root, currentWorkspaces.map((entry: WorkspaceConfig) => entry.id)),
      root,
    });
  }

  if (existingWorker) {
    let workspaces = currentWorkspaces;
    if (initialWorkspace && !workspaces.some((entry: WorkspaceConfig) => entry.id === initialWorkspace.id)) workspaces = [...workspaces, initialWorkspace];
    if (!workspaces.length) throw new Error("Worker setup requires at least one authorized Workspace");
    const next = runtimeConfigSchema.parse({
      ...current,
      worker: { ...existingWorker, listen: { ...existingWorker.listen, port } },
      workspaces,
    });
    await persistRuntimeConfig(configFile, next, true);
    if (!portArg && !prompt) outro(`Worker updated: ${environmentId}`);
    return { setup: true, mode: "edit", role: "worker", file: configFile, workerId: existingWorker.workerId, environmentId, port, workspaceCount: workspaces.length };
  }

  if (!initialWorkspace) throw new Error("Worker setup requires an initial authorized Workspace");
  const workspaces = currentWorkspaces.some((entry: WorkspaceConfig) => entry.id === initialWorkspace.id) ? currentWorkspaces : [...currentWorkspaces, initialWorkspace];
  const tokenFile = path.join(secretsDirectory, `worker-${environmentId}.secret`);
  await writeFile(tokenFile, `${randomBytes(32).toString("base64url")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  try {
    await secureRuntimeFile(tokenFile);
    const next = runtimeConfigSchema.parse({ ...current, worker: { workerId: randomUUID(), environmentId, listen: { host: "127.0.0.1", port }, tokenFile }, workspaces });
    await persistRuntimeConfig(configFile, next);
    if (!portArg && !prompt) outro(`Worker setup complete: ${environmentId}`);
    return { setup: true, mode: "create", role: "worker", file: configFile, workerId: next.worker?.workerId, environmentId, port, workspaceCount: workspaces.length };
  } catch (error) {
    await rm(tokenFile, { force: true }).catch(() => undefined);
    throw error;
  }
}
