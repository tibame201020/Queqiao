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
import { queqiaoMultiselect } from "./tui-multiselect.js";

function option(args: string[], name: string): string | undefined { const index = args.indexOf(`--${name}`); return index >= 0 ? args[index + 1] : undefined; }
function requiredOption(args: string[], name: string): string { const value = option(args, name); if (!value) throw new Error(`--${name} is required`); return value; }
function assertAllowedOptions(args: string[], command: string, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed.map((name) => `--${name}`));
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    if (!allowedSet.has(arg)) throw new Error(`Unknown option "${arg}" for "${command}"`);
  }
}
export type JoinPrompt = (field: "code" | "protocols", message: string) => Promise<string>;
export type WorkerSetupPrompt = (field: "port", message: string, initialValue: string) => Promise<string>;
export type WorkerSetupOptions = { initialWorkspace?: WorkspaceConfig };
export type GatewaySetupPrompt = (field: "public-base-url", message: string, initialValue?: string) => Promise<string>;

type JoinCodeEnvelope = {
  v: 1;
  gateway: string;
  token: string;
  expiresAt?: string;
};

export type GatewayProtocolOffer =
  | { type: "http"; capable: boolean }
  | { type: "grpc"; capable: boolean; connection?: { target: string; security?: "tls" | "loopback"; caCertificate?: string } };

export function describeGatewayProtocolOffer(offer: GatewayProtocolOffer): string {
  if (offer.type === "grpc") {
    const target = offer.connection?.target;
    if (!offer.capable) return target ? `Unavailable · session target ${target}` : "Currently unavailable";
    return target ? `Available · session target ${target}` : "Available · gRPC session";
  }
  return offer.capable ? "Available · loopback Worker endpoint" : "Currently unavailable";
}

const JOIN_CODE_PREFIX = "qjq1:";

export function encodeJoinCode(envelope: JoinCodeEnvelope): string {
  const gatewayError = validateGatewayUrl(envelope.gateway);
  if (gatewayError) throw new Error(gatewayError);
  if (!envelope.token.trim()) throw new Error("Join token is required");
  const slim: JoinCodeEnvelope = { v: 1, gateway: new URL(envelope.gateway).href, token: envelope.token, ...(envelope.expiresAt ? { expiresAt: envelope.expiresAt } : {}) };
  return `${JOIN_CODE_PREFIX}${Buffer.from(JSON.stringify(slim), "utf8").toString("base64url")}`;
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

async function resolveJoinInputs(args: string[], prompt?: JoinPrompt): Promise<{ gateway: string; token: string; interactive: boolean }> {
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

  intro("Join Worker");
  const code = String(assertPromptNotCancelled(await password({
    message: "Join code",
    validate: (value) => {
      if (!value?.trim()) return "Join code is required";
      try { decodeJoinCode(value); return undefined; } catch { return "Invalid join code"; }
    },
  }), "Worker join cancelled")).trim();
  const decoded = decodeJoinCode(code);
  return { gateway: decoded.gateway, token: decoded.token, interactive: true };
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


export async function removeJoinedWorker(configFile: string, workerId: string): Promise<unknown> {
  return jsonOrThrow(await managementRequest(configFile, `/workers/${encodeURIComponent(workerId)}`, { method: "DELETE" }));
}

async function discoverGatewayProtocols(gateway: URL, joinToken: string): Promise<GatewayProtocolOffer[]> {
  const response = await fetch(new URL("enrollment/protocols", gateway), {
    headers: { authorization: `Bearer ${joinToken}` },
    signal: AbortSignal.timeout(5000),
  });
  const body = await jsonOrThrow(response) as { protocols?: unknown };
  if (!Array.isArray(body.protocols)) throw new Error("Gateway returned invalid protocol capabilities");
  return body.protocols.flatMap((raw): GatewayProtocolOffer[] => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const capable = value.capable === true || value.available === true;
    if (value.type === "http") return [{ type: "http", capable }];
    if (value.type === "grpc") {
      const connection = value.connection && typeof value.connection === "object" ? value.connection as Record<string, unknown> : undefined;
      return [{ type: "grpc", capable, ...(connection && typeof connection.target === "string" ? { connection: {
        target: connection.target,
        ...(connection.security === "tls" || connection.security === "loopback" ? { security: connection.security } : {}),
        ...(typeof connection.caCertificate === "string" ? { caCertificate: connection.caCertificate } : {}),
      } } : {}) }];
    }
    return [];
  });
}

export async function inspectJoinProtocols(joinCodeValue: string): Promise<{ gateway: string; offers: GatewayProtocolOffer[] }> {
  const decoded = decodeJoinCode(joinCodeValue);
  const gateway = new URL(decoded.gateway);
  return { gateway: gateway.href, offers: await discoverGatewayProtocols(gateway, decoded.token) };
}

async function discoverMembershipProtocols(gateway: URL, workerId: string, credential: string): Promise<{ offers: GatewayProtocolOffer[]; enabled: string[] }> {
  const response = await fetch(new URL(`enrollment/protocols?workerId=${encodeURIComponent(workerId)}`, gateway), {
    headers: { "x-queqiao-worker-token": credential },
    signal: AbortSignal.timeout(5000),
  });
  const body = await jsonOrThrow(response) as { protocols?: unknown; enabled?: unknown };
  if (!Array.isArray(body.protocols)) throw new Error("Gateway returned invalid protocol capabilities");
  const offers = body.protocols.flatMap((raw): GatewayProtocolOffer[] => {
    if (!raw || typeof raw !== "object") return [];
    const value = raw as Record<string, unknown>;
    const capable = value.capable === true || value.available === true;
    if (value.type === "http") return [{ type: "http", capable }];
    if (value.type === "grpc") {
      const connection = value.connection && typeof value.connection === "object" ? value.connection as Record<string, unknown> : undefined;
      return [{ type: "grpc", capable, ...(connection && typeof connection.target === "string" ? { connection: {
        target: connection.target,
        ...(connection.security === "tls" || connection.security === "loopback" ? { security: connection.security } : {}),
        ...(typeof connection.caCertificate === "string" ? { caCertificate: connection.caCertificate } : {}),
      } } : {}) }];
    }
    return [];
  });
  const enabled = Array.isArray(body.enabled) ? body.enabled.filter((value): value is string => typeof value === "string") : [];
  return { offers, enabled };
}

function parseProtocolSelection(value: string, offers: GatewayProtocolOffer[]): GatewayProtocolOffer[] {
  const requested = [...new Set(value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean))];
  if (!requested.length) throw new Error("Select at least one Worker protocol");
  return requested.map((type) => {
    const offer = offers.find((candidate) => candidate.type === type);
    if (!offer) throw new Error(`Gateway does not offer Worker protocol: ${type}`);
    if (!offer.capable) throw new Error(`Worker protocol is not currently available: ${type}`);
    return offer;
  });
}

async function selectJoinProtocols(args: string[], prompt: JoinPrompt | undefined, offers: GatewayProtocolOffer[]): Promise<GatewayProtocolOffer[]> {
  const capable = offers.filter((offer) => offer.capable);
  if (!capable.length) throw new Error("Gateway has no available Worker protocols");
  const arg = option(args, "protocols");
  if (arg) return parseProtocolSelection(arg, offers);
  if (prompt) return parseProtocolSelection(await prompt("protocols", "Worker protocols"), offers);
  if (option(args, "join-code") && !(process.stdin.isTTY && process.stdout.isTTY)) {
    throw new Error("--protocols is required with --join-code outside an interactive terminal");
  }
  const selected = assertPromptNotCancelled(await queqiaoMultiselect({
    message: "Worker protocols",
    choices: offers.map((offer) => ({ value: offer.type, label: offer.type === "grpc" ? "gRPC" : "HTTP", description: describeGatewayProtocolOffer(offer), disabled: !offer.capable })),
    initialValues: capable.map((offer) => offer.type),
    required: true,
    validate: (value) => value?.length ? undefined : "Please select at least one protocol.",
    summary: (selectedValues) => selectedValues.join(", "),
  }), "Worker join cancelled") as string[];
  return parseProtocolSelection(selected.join(","), offers);
}

async function persistGatewayMembership(
  configFile: string,
  gateway: URL,
  credential: string,
  selected: GatewayProtocolOffer[],
): Promise<void> {
  const latest = await readRuntimeConfig(configFile);
  if (!latest.worker) throw new Error("worker configuration is required");
  const priorMembership = latest.worker.memberships.find((membership) => membership.gateway === gateway.href);
  const directory = path.dirname(path.resolve(latest.worker.tokenFile));
  await secureRuntimeDirectory(directory);
  const credentialFile = path.join(directory, `gateway-membership-${randomUUID()}.secret`);
  await writeFile(credentialFile, `${credential}
`, { encoding: "utf8", mode: 0o600, flag: "wx" });
  await secureRuntimeFile(credentialFile);
  let caCertificateFile: string | undefined;
  try {
    const grpc = selected.find((offer): offer is Extract<GatewayProtocolOffer, { type: "grpc" }> => offer.type === "grpc");
    let grpcState: { target: string; security: "tls" | "loopback"; caCertificateFile?: string } | undefined;
    if (grpc?.connection) {
      const security = grpc.connection.security ?? (grpc.connection.caCertificate ? "tls" : "loopback");
      if (security === "tls") {
        if (!grpc.connection.caCertificate) throw new Error("Gateway gRPC TLS capability is missing its CA certificate");
        caCertificateFile = path.join(directory, `gateway-membership-${randomUUID()}.crt`);
        await writeFile(caCertificateFile, grpc.connection.caCertificate, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await secureRuntimeFile(caCertificateFile);
      }
      grpcState = { target: grpc.connection.target, security, ...(caCertificateFile ? { caCertificateFile } : {}) };
    }
    const next = runtimeConfigSchema.parse({
      ...latest,
      worker: {
        ...latest.worker,
        memberships: [
          ...latest.worker.memberships.filter((membership) => membership.gateway !== gateway.href),
          {
            gateway: gateway.href,
            credentialRef: { kind: "secret-file", path: credentialFile },
            protocols: { ...(grpcState ? { grpc: grpcState } : {}) },
          },
        ],
      },
    });
    await persistRuntimeConfig(configFile, next);
    if (priorMembership) {
      await rm(path.resolve(priorMembership.credentialRef.path), { force: true }).catch(() => undefined);
      if (priorMembership.protocols.grpc?.caCertificateFile) await rm(path.resolve(priorMembership.protocols.grpc.caCertificateFile), { force: true }).catch(() => undefined);
    }
  } catch (error) {
    await rm(credentialFile, { force: true }).catch(() => undefined);
    if (caCertificateFile) await rm(caCertificateFile, { force: true }).catch(() => undefined);
    throw error;
  }
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

async function activateLocalReverseSession(endpoint: URL, localCredential: string, membershipCredential: string, gateway: URL, grpc: Extract<GatewayProtocolOffer, { type: "grpc" }>): Promise<void> {
  if (!grpc.connection) throw new Error("Gateway gRPC connection metadata is unavailable");
  const response = await fetch(new URL("enrollment/reverse-session/connect", endpoint), {
    method: "POST",
    headers: { "content-type": "application/json", "x-queqiao-worker-token": localCredential },
    body: JSON.stringify({ ...grpc.connection, gateway: gateway.href, credential: membershipCredential }),
    signal: AbortSignal.timeout(10_000),
  });
  await jsonOrThrow(response);
}

async function disconnectLocalReverseSession(endpoint: URL, localCredential: string, gateway: URL): Promise<void> {
  const response = await fetch(new URL("enrollment/reverse-session/disconnect", endpoint), {
    method: "POST",
    headers: { "content-type": "application/json", "x-queqiao-worker-token": localCredential },
    body: JSON.stringify({ gateway: gateway.href }),
    signal: AbortSignal.timeout(5000),
  });
  await jsonOrThrow(response);
}

async function persistChangedMembershipProtocols(configFile: string, gateway: URL, selected: GatewayProtocolOffer[]): Promise<void> {
  const latest = await readRuntimeConfig(configFile);
  if (!latest.worker) throw new Error("worker configuration is required");
  const index = latest.worker.memberships.findIndex((membership) => membership.gateway === gateway.href);
  if (index < 0) throw new Error(`Worker Gateway membership is unavailable: ${gateway.href}`);
  const membership = latest.worker.memberships[index]!;
  const directory = path.dirname(path.resolve(latest.worker.tokenFile));
  const grpc = selected.find((offer): offer is Extract<GatewayProtocolOffer, { type: "grpc" }> => offer.type === "grpc");
  const oldCa = membership.protocols.grpc?.caCertificateFile;
  let newCa: string | undefined;
  try {
    let grpcState: { target: string; security: "tls" | "loopback"; caCertificateFile?: string } | undefined;
    if (grpc) {
      if (!grpc.connection) throw new Error("Gateway gRPC connection metadata is unavailable");
      const security = grpc.connection.security ?? (grpc.connection.caCertificate ? "tls" : "loopback");
      if (security === "tls") {
        if (!grpc.connection.caCertificate) throw new Error("Gateway gRPC TLS capability is missing its CA certificate");
        newCa = path.join(directory, `gateway-membership-${randomUUID()}.crt`);
        await writeFile(newCa, grpc.connection.caCertificate, { encoding: "utf8", mode: 0o600, flag: "wx" });
        await secureRuntimeFile(newCa);
      }
      grpcState = { target: grpc.connection.target, security, ...(newCa ? { caCertificateFile: newCa } : {}) };
    }
    const memberships = [...latest.worker.memberships];
    memberships[index] = { ...membership, protocols: { ...(grpcState ? { grpc: grpcState } : {}) } };
    const next = runtimeConfigSchema.parse({ ...latest, worker: { ...latest.worker, memberships } });
    await persistRuntimeConfig(configFile, next, true);
  } catch (error) {
    if (newCa) await rm(newCa, { force: true }).catch(() => undefined);
    throw error;
  }
  if (oldCa && oldCa !== newCa) await rm(oldCa, { force: true }).catch(() => undefined);
}

export type WorkerMembershipProtocolState = { gateway: string; enabled: string[]; offers: GatewayProtocolOffer[] };

export async function inspectWorkerMembershipProtocols(configFile: string, gatewayValue: string): Promise<WorkerMembershipProtocolState> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker?.workerId) throw new Error("worker configuration is required");
  const gateway = new URL(gatewayValue);
  const membership = runtime.worker.memberships.find((entry) => entry.gateway === gateway.href);
  if (!membership) throw new Error(`Worker Gateway membership is unavailable: ${gateway.href}`);
  const credential = (await readFile(path.resolve(membership.credentialRef.path), "utf8")).trim();
  if (Buffer.byteLength(credential) < 32) throw new Error(`Worker Gateway membership credential is invalid: ${gateway.href}`);
  const discovered = await discoverMembershipProtocols(gateway, runtime.worker.workerId, credential);
  return { gateway: gateway.href, enabled: discovered.enabled, offers: discovered.offers };
}

export async function reconcileWorkerMembershipProtocols(configFile: string, gatewayValue: string): Promise<WorkerMembershipProtocolState> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker?.workerId) throw new Error("worker configuration is required");
  const gateway = new URL(gatewayValue);
  const membership = runtime.worker.memberships.find((entry) => entry.gateway === gateway.href);
  if (!membership) throw new Error(`Worker Gateway membership is unavailable: ${gateway.href}`);
  const state = await inspectWorkerMembershipProtocols(configFile, gateway.href);
  if (state.enabled.some((type) => type !== "http" && type !== "grpc")) return state;
  const grpcEnabled = state.enabled.includes("grpc");
  const grpcOffer = state.offers.find((offer): offer is Extract<GatewayProtocolOffer, { type: "grpc" }> => offer.type === "grpc");
  if (grpcEnabled) {
    if (!grpcOffer?.capable || !grpcOffer.connection) return state;
    const security = grpcOffer.connection.security ?? (grpcOffer.connection.caCertificate ? "tls" : "loopback");
    const local = membership.protocols.grpc;
    let matches = Boolean(local && local.target === grpcOffer.connection.target && local.security === security);
    if (matches && security === "tls") {
      if (!local?.caCertificateFile || !grpcOffer.connection.caCertificate) matches = false;
      else {
        const persistedCa = await readFile(path.resolve(local.caCertificateFile), "utf8").catch(() => "");
        matches = persistedCa === grpcOffer.connection.caCertificate;
      }
    }
    if (matches) return state;
  } else if (!membership.protocols.grpc) {
    return state;
  }
  const selected = state.enabled.flatMap((type) => {
    const offer = state.offers.find((candidate) => candidate.type === type);
    return offer?.capable ? [offer] : [];
  });
  if (selected.length !== state.enabled.length) return state;
  await persistChangedMembershipProtocols(configFile, gateway, selected);
  return state;
}

export async function changeWorkerMembershipProtocols(configFile: string, gatewayValue: string, selectedTypes: string[]): Promise<unknown> {
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker?.workerId) throw new Error("worker configuration is required");
  const gateway = new URL(gatewayValue);
  const membership = runtime.worker.memberships.find((entry) => entry.gateway === gateway.href);
  if (!membership) throw new Error(`Worker Gateway membership is unavailable: ${gateway.href}`);
  const credential = (await readFile(path.resolve(membership.credentialRef.path), "utf8")).trim();
  const localCredential = (await readFile(path.resolve(runtime.worker.tokenFile), "utf8")).trim();
  if (Buffer.byteLength(credential) < 32 || Buffer.byteLength(localCredential) < 32) throw new Error("Worker credential is invalid");
  const endpoint = new URL(`http://127.0.0.1:${runtime.worker.listen.port}/`);
  const { offers, enabled } = await discoverMembershipProtocols(gateway, runtime.worker.workerId, credential);
  const selected = parseProtocolSelection(selectedTypes.join(","), offers);
  const selectedSet = new Set(selected.map((offer) => offer.type));
  const enabledSet = new Set(enabled);
  const addingGrpc = selectedSet.has("grpc") && !enabledSet.has("grpc");
  const removingGrpc = !selectedSet.has("grpc") && enabledSet.has("grpc");
  let preparedGrpc = false;
  let gatewayCommitted = false;
  try {
    if (addingGrpc) {
      const grpc = selected.find((offer): offer is Extract<GatewayProtocolOffer, { type: "grpc" }> => offer.type === "grpc");
      if (!grpc) throw new Error("gRPC capability is unavailable");
      await activateLocalReverseSession(endpoint, localCredential, credential, gateway, grpc);
      preparedGrpc = true;
    }
    const transports = selected.map((offer) => offer.type === "http"
      ? { type: "http" as const, endpoint: endpoint.href }
      : { type: "grpc" as const, mode: "reverse" as const });
    const updated = await jsonOrThrow(await fetch(new URL("enrollment/protocols", gateway), {
      method: "PUT",
      headers: { "content-type": "application/json", "x-queqiao-worker-token": credential },
      body: JSON.stringify({ workerId: runtime.worker.workerId, transports }),
      signal: AbortSignal.timeout(15_000),
    }));
    gatewayCommitted = true;
    await persistChangedMembershipProtocols(configFile, gateway, selected);
    if (removingGrpc) await disconnectLocalReverseSession(endpoint, localCredential, gateway);
    return updated;
  } catch (error) {
    if (preparedGrpc && !gatewayCommitted) await disconnectLocalReverseSession(endpoint, localCredential, gateway).catch(() => undefined);
    throw error;
  }
}

async function controlMembershipTransaction(endpoint: URL, localCredential: string, action: "stage" | "commit" | "revoke", body: Record<string, unknown>): Promise<void> {
  const response = await fetch(new URL(`enrollment/membership/${action}`, endpoint), {
    method: "POST",
    headers: { "content-type": "application/json", "x-queqiao-worker-token": localCredential },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(5000),
  });
  await jsonOrThrow(response);
}

export async function joinWorker(configFile: string, args: string[], prompt?: JoinPrompt): Promise<unknown> {
  assertAllowedOptions(args, "queqiao worker join", ["worker", "join-code", "protocols", "json"]);
  const runtime = await readRuntimeConfig(configFile);
  if (!runtime.worker) throw new Error("worker configuration is required");
  if (!runtime.worker.workerId) throw new Error("Worker has no stable workerId; run worker setup or migrate the Worker identity first");
  const endpoint = new URL(`http://127.0.0.1:${runtime.worker.listen.port}/`);
  const localCredentialFile = path.resolve(runtime.worker.tokenFile);
  const localCredential = (await readFile(localCredentialFile, "utf8")).trim();
  if (Buffer.byteLength(localCredential) < 32) throw new Error("Worker local control credential is invalid");
  const workerName = option(args, "worker") || runtime.worker.environmentId;
  await preflightLocalWorker(endpoint, { workerId: runtime.worker.workerId, environmentId: runtime.worker.environmentId }, localCredentialFile, workerName);
  const inputs = await resolveJoinInputs(args, prompt);
  const gateway = new URL(inputs.gateway);
  // Gateway is authoritative for duplicate enrollment. A local record may be stale after
  // the Gateway removed this Worker; let /enrollment/join/start distinguish those cases.
  const offers = await discoverGatewayProtocols(gateway, inputs.token);
  const selected = await selectJoinProtocols(args, prompt, offers);
  const transports = selected.map((offer) => offer.type === "http"
    ? { type: "http" as const, endpoint: endpoint.href }
    : { type: "grpc" as const, mode: "reverse" as const });
  const start = await jsonOrThrow(await fetch(new URL("enrollment/join/start", gateway), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ token: inputs.token, workerId: runtime.worker.workerId, environmentId: runtime.worker.environmentId, transports }),
    signal: AbortSignal.timeout(5000),
  }));
  const transactionId = String(start.transactionId || "");
  const credential = String(start.credential || "");
  if (!transactionId || Buffer.byteLength(credential) < 32) throw new Error("Gateway returned an invalid provisional enrollment response");
  await controlMembershipTransaction(endpoint, localCredential, "stage", { transactionId, gateway: gateway.href, credential });
  let gatewayCommitted = false;
  try {
    const grpc = selected.find((offer): offer is Extract<GatewayProtocolOffer, { type: "grpc" }> => offer.type === "grpc");
    if (grpc) await activateLocalReverseSession(endpoint, localCredential, credential, gateway, grpc);
    const confirmed = await jsonOrThrow(await fetch(new URL("enrollment/join/confirm", gateway), {
      method: "POST",
      headers: { "content-type": "application/json", "x-queqiao-worker-token": credential },
      body: JSON.stringify({ transactionId }),
      signal: AbortSignal.timeout(15_000),
    }));
    gatewayCommitted = true;
    await persistGatewayMembership(configFile, gateway, credential, selected);
    await controlMembershipTransaction(endpoint, localCredential, "commit", { transactionId });
    if (inputs.interactive && !prompt) outro(`Worker joined: ${runtime.worker.environmentId}`);
    return confirmed;
  } catch (error) {
    if (!gatewayCommitted) {
      await controlMembershipTransaction(endpoint, localCredential, "revoke", { transactionId }).catch(() => undefined);
      if (selected.some((offer) => offer.type === "grpc")) await disconnectLocalReverseSession(endpoint, localCredential, gateway).catch(() => undefined);
    } else {
      await controlMembershipTransaction(endpoint, localCredential, "commit", { transactionId }).catch(() => undefined);
    }
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
  assertAllowedOptions(args, "queqiao gateway setup", ["public-base-url", "port", "management-port", "worker-session-mode", "worker-session-host", "worker-session-port"]);
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
  const requestedWorkerSessionMode = option(args, "worker-session-mode")?.trim();
  const requestedWorkerSessionHost = option(args, "worker-session-host")?.trim();
  if (requestedWorkerSessionMode && requestedWorkerSessionMode !== "local" && requestedWorkerSessionMode !== "remote") throw new Error("Worker session mode must be local or remote");
  const requestedWorkerSessionPort = option(args, "worker-session-port");
  if (!Number.isInteger(gatewayPort) || gatewayPort < 1 || gatewayPort > 65535) throw new Error("Gateway port must be between 1 and 65535");
  if (!Number.isInteger(managementPort) || managementPort < 1 || managementPort > 65535) throw new Error("Management port must be between 1 and 65535");
  if (gatewayPort === managementPort) throw new Error("Gateway and Management ports must be different");
  if (requestedWorkerSessionHost && (requestedWorkerSessionHost.includes("://") || requestedWorkerSessionHost.includes("/") || /\s/.test(requestedWorkerSessionHost))) {
    throw new Error("Worker session host must be a DNS name or IP address without a scheme or path");
  }

  const existingRemoteHost = existingGateway?.workerSessionAdvertiseHost as string | undefined;
  const effectiveRemoteHost = requestedWorkerSessionHost || existingRemoteHost;
  const explicitlyLocal = requestedWorkerSessionMode === "local";
  const remoteEnabled = requestedWorkerSessionMode === "remote"
    ? Boolean(effectiveRemoteHost)
    : explicitlyLocal
      ? false
      : Boolean(effectiveRemoteHost && (requestedWorkerSessionHost || existingGateway?.workerSessionListen?.host === "0.0.0.0"));
  if (requestedWorkerSessionMode === "remote" && !effectiveRemoteHost) throw new Error("Remote Worker session mode requires --worker-session-host or an existing advertised host");
  if (requestedWorkerSessionPort && !remoteEnabled) throw new Error("--worker-session-port requires remote Worker session mode");

  let workerSessionPatch: Record<string, unknown> = {};
  let obsoleteTls: { certFile?: string; keyFile?: string } | undefined = explicitlyLocal ? existingGateway?.workerSessionTls : undefined;
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
    const gatewayBase = explicitlyLocal
      ? (({ workerSessionListen: _listen, workerSessionAdvertiseHost: _host, workerSessionTls: _tls, ...rest }) => rest)(existingGateway)
      : existingGateway;
    const next = runtimeConfigSchema.parse({
      ...current,
      gateway: {
        ...gatewayBase,
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
