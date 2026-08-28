import { access, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import path from "node:path";
import { cancel, intro, isCancel, outro, password, text } from "@clack/prompts";
import { runtimeConfigSchema, readRuntimeConfig, type RuntimeConfig } from "@queqiao/config";
import { AtomicConfigStore } from "./atomic-config-store.js";
import { resolveWorkspaceAuthorityRoot } from "./workspace-authority.js";
import { secureRuntimeDirectory, secureRuntimeFile } from "./secure-runtime-paths.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
export type JoinPrompt = (field: "code", message: string) => Promise<string>;
export type WorkerSetupPrompt = (field: "port", message: string, initialValue: string) => Promise<string>;
export type GatewaySetupPrompt = (field: "public-base-url", message: string, initialValue?: string) => Promise<string>;

type JoinCodeEnvelope = {
  v: 1;
  gateway: string;
  token: string;
  expiresAt?: string;
};

const JOIN_CODE_PREFIX = "qjq1:";

export function encodeJoinCode(envelope: JoinCodeEnvelope): string {
  const gatewayError = validateGatewayUrl(envelope.gateway);
  if (gatewayError) throw new Error(gatewayError);
  if (!envelope.token.trim()) throw new Error("Join token is required");
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
    return { v: 1, gateway: new URL(parsed.gateway).href, token: parsed.token, ...(typeof parsed.expiresAt === "string" ? { expiresAt: parsed.expiresAt } : {}) };
  } catch (error) {
    if (error instanceof Error && error.message === "Invalid join code") throw error;
    throw new Error("Invalid join code");
  }
}

function assertJoinNotCancelled<T>(value: T | symbol): T {
  if (!isCancel(value)) return value as T;
  cancel("Worker join cancelled");
  throw new Error("Worker join cancelled");
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

async function resolveJoinInputs(args: string[], prompt?: JoinPrompt): Promise<{ gateway: string; token: string; interactive: boolean }> {
  if (args.includes("--gateway") || args.includes("--token")) {
    throw new Error("--gateway and --token are not supported for Worker enrollment; use --join-code or run worker join interactively");
  }
  const codeArg = option(args, "join-code");
  if (codeArg) {
    const decoded = decodeJoinCode(codeArg);
    return { gateway: decoded.gateway, token: decoded.token, interactive: false };
  }

  if (prompt) {
    const code = (await prompt("code", "Join code")).trim();
    if (!code) throw new Error("Join code is required");
    const decoded = decodeJoinCode(code);
    return { gateway: decoded.gateway, token: decoded.token, interactive: true };
  }

  intro("Join worker");
  const code = String(assertJoinNotCancelled(await password({
    message: "Join code",
    validate: (value) => {
      if (!value?.trim()) return "Join code is required";
      try { decodeJoinCode(value); return undefined; } catch { return "Invalid join code"; }
    },
  }))).trim();
  const decoded = decodeJoinCode(code);
  return { gateway: decoded.gateway, token: decoded.token, interactive: true };
}

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
  const expires = option(args, "expires");
  const response = await managementRequest(configFile, "/join-tokens", {
    method: "POST",
    body: JSON.stringify({ ...(expires ? { expiresSeconds: Number(expires) } : {}), ...(option(args, "worker-id") ? { workerId: option(args, "worker-id") } : {}), ...(option(args, "environment-id") ? { environmentId: option(args, "environment-id") } : {}) }),
  });
  const result = await jsonOrThrow(response);
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.gateway) throw new Error("gateway configuration is required");
  const joinCode = encodeJoinCode({
    v: 1,
    gateway: runtime.gateway.publicBaseUrl,
    token: String(result.token || ""),
    ...(typeof result.expiresAt === "string" ? { expiresAt: result.expiresAt } : {}),
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

export async function joinWorker(configFile: string, args: string[], prompt?: JoinPrompt): Promise<unknown> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker) throw new Error("worker configuration is required");
  if (!runtime.worker.workerId) throw new Error("Worker has no stable workerId; run worker setup or migrate the Worker identity first");
  const inputs = await resolveJoinInputs(args, prompt);
  const joinToken = inputs.token;
  const gateway = new URL(inputs.gateway);
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
    if (inputs.interactive && !prompt) outro(`Worker joined: ${runtime.worker.environmentId}`);
    return confirmed;
  } catch (error) {
    await rollbackProvisional(tokenFile, state);
    throw error;
  }
}

export async function setupGateway(configFile: string, args: string[], stateDirectoryDefault: string, secretsDirectory: string, prompt?: GatewaySetupPrompt): Promise<unknown> {
  let current: any = { version: 1, workspaces: [] };
  try { current = await readRuntimeConfig(configFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

  const existingGateway = current.gateway;
  let publicBaseUrlValue = option(args, "public-base-url");
  if (!publicBaseUrlValue) {
    const initialValue = existingGateway?.publicBaseUrl;
    if (prompt) {
      publicBaseUrlValue = (await prompt("public-base-url", "Public Gateway URL", initialValue)).trim() || initialValue;
    } else if (process.stdin.isTTY && process.stdout.isTTY) {
      intro(existingGateway ? "Edit Gateway" : "Configure Gateway");
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

  if (existingGateway) {
    const next = runtimeConfigSchema.parse({
      ...current,
      gateway: {
        ...existingGateway,
        publicBaseUrl: publicBaseUrl.href,
        listen: { ...existingGateway.listen, port: Number(option(args, "port") || existingGateway.listen.port) },
        managementListen: { ...existingGateway.managementListen, port: Number(option(args, "management-port") || existingGateway.managementListen.port) },
      },
    });
    await persistRuntimeConfig(configFile, next);
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
  const next = runtimeConfigSchema.parse({ ...current, gateway: { publicBaseUrl: publicBaseUrl.href, listen: { host: "127.0.0.1", port: Number(option(args, "port") || 7575) }, managementListen: { host: "127.0.0.1", port: Number(option(args, "management-port") || 7574) }, trustProxyHops: 1, stateDirectory: stateDirectoryDefault, approvalSecretFile, jwtSigningSecretFile } });
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
      intro("Configure worker");
      portValue = String(assertJoinNotCancelled(await text({
        message: "Worker port",
        placeholder: currentPort,
        defaultValue: currentPort,
        validate: (value) => validatePort(value || currentPort),
      }))).trim() || currentPort;
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

export async function setupWorker(configFile: string, args: string[], secretsDirectory: string, prompt?: WorkerSetupPrompt): Promise<unknown> {
  let current: any = { version: 1, workspaces: [] };
  try { current = await readRuntimeConfig(configFile); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }

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
      intro(existingWorker ? "Edit worker" : "Setup worker");
      portValue = String(assertJoinNotCancelled(await text({
        message: "Worker port",
        placeholder: initialPort,
        defaultValue: initialPort,
        validate: (value) => validatePort(value || initialPort),
      }))).trim() || initialPort;
    }
  }
  const portError = validatePort(portValue);
  if (portError) throw new Error(portError);
  const port = Number(portValue);

  if (existingWorker) {
    const next = runtimeConfigSchema.parse({
      ...current,
      worker: { ...existingWorker, listen: { ...existingWorker.listen, port } },
      workspaces: current.workspaces || [],
    });
    await persistRuntimeConfig(configFile, next);
    if (!portArg && !prompt) outro(`Worker updated: ${environmentId}`);
    return { setup: true, mode: "edit", role: "worker", file: configFile, workerId: existingWorker.workerId, environmentId, port };
  }

  const tokenFile = path.join(secretsDirectory, `worker-${environmentId}.secret`);
  await writeFile(tokenFile, `${randomBytes(32).toString("base64url")}\n`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await secureRuntimeFile(tokenFile);
  const next = runtimeConfigSchema.parse({ ...current, worker: { workerId: randomUUID(), environmentId, listen: { host: "127.0.0.1", port }, tokenFile }, workspaces: current.workspaces || [] });
  await persistRuntimeConfig(configFile, next);
  if (!portArg && !prompt) outro(`Worker setup complete: ${environmentId}`);
  return { setup: true, mode: "create", role: "worker", file: configFile, workerId: next.worker?.workerId, environmentId, port };
}