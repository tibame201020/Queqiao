import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { QUEQIAO_WORKER_PROTOCOL_VERSION, workerHelloV3Schema, type WorkerHelloV3 } from "@queqiao/worker-protocol";
import { secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";
import { gatewayVisibleTransportKey, WorkerMembershipStore, workerMembershipSchema, workerTransportDescriptorSchema, type WorkerMembership, type WorkerTransportDescriptor } from "./worker-membership-store.js";
import { WorkerSessionRegistry, type WorkerSessionAuthentication } from "./worker-session-registry.js";

const joinStartSchema = z.preprocess((raw) => {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const candidate = raw as Record<string, unknown>;
  if (Array.isArray(candidate.transports)) return candidate;
  if (candidate.transport) {
    const { transport, ...rest } = candidate;
    return { ...rest, transports: [transport] };
  }
  return candidate;
}, z.object({
  token: z.string().min(32).max(256),
  workerId: z.uuid(),
  environmentId: z.string().min(1).max(64),
  transports: z.array(workerTransportDescriptorSchema).min(1).max(8),
}));

export type JoinStartRequest = z.infer<typeof joinStartSchema>;
export type JoinTokenOptions = { expiresSeconds?: number; workerId?: string; environmentId?: string };

type JoinToken = { digest: string; expiresAt: number; workerId?: string; environmentId?: string };
type ProvisionalJoin = {
  transactionId: string;
  workerId: string;
  environmentId: string;
  transports: WorkerTransportDescriptor[];
  credential: string;
  expiresAt: number;
};

function digest(value: string): string { return createHash("sha256").update(value).digest("hex"); }
function safeEqual(left: string, right: string): boolean {
  return timingSafeEqual(createHash("sha256").update(left).digest(), createHash("sha256").update(right).digest());
}

export class EnrollmentError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "EnrollmentError"; }
}

export class EnrollmentService {
  private readonly joinTokens = new Map<string, JoinToken>();
  private readonly provisional = new Map<string, ProvisionalJoin>();

  constructor(
    readonly memberships: WorkerMembershipStore,
    readonly stateDirectory: string,
    private readonly sessions?: WorkerSessionRegistry,
  ) {}

  private purge(now = Date.now()): void {
    for (const [key, token] of this.joinTokens) if (token.expiresAt <= now) this.joinTokens.delete(key);
    for (const [key, join] of this.provisional) {
      if (join.expiresAt > now) continue;
      this.provisional.delete(key);
      this.sessions?.detachProvisional(join.transactionId, new Error("Worker join transaction expired"));
    }
  }

  createJoinToken(options: JoinTokenOptions = {}): { token: string; expiresAt: string; bindings: { workerId?: string; environmentId?: string } } {
    this.purge();
    const expiresSeconds = options.expiresSeconds ?? 300;
    if (!Number.isInteger(expiresSeconds) || expiresSeconds < 30 || expiresSeconds > 3600) throw new EnrollmentError(400, "invalid_expiry", "Join token expiry must be between 30 and 3600 seconds");
    if (options.workerId) z.uuid().parse(options.workerId);
    if (options.environmentId && !/^[a-z][a-z0-9_-]{0,63}$/.test(options.environmentId)) throw new EnrollmentError(400, "invalid_environment_id", "Invalid environmentId binding");
    const token = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + expiresSeconds * 1000;
    this.joinTokens.set(digest(token), { digest: digest(token), expiresAt, ...(options.workerId ? { workerId: options.workerId } : {}), ...(options.environmentId ? { environmentId: options.environmentId } : {}) });
    return { token, expiresAt: new Date(expiresAt).toISOString(), bindings: { ...(options.workerId ? { workerId: options.workerId } : {}), ...(options.environmentId ? { environmentId: options.environmentId } : {}) } };
  }

  async startJoin(raw: unknown): Promise<{ transactionId: string; credential: string; confirmBy: string }> {
    this.purge();
    const request = joinStartSchema.parse(raw);
    const key = digest(request.token);
    const token = this.joinTokens.get(key);
    if (!token) throw new EnrollmentError(401, "invalid_join_token", "Join token is invalid, expired, or already consumed");
    this.joinTokens.delete(key);
    if (token.expiresAt <= Date.now()) throw new EnrollmentError(401, "expired_join_token", "Join token has expired");
    if (token.workerId && token.workerId !== request.workerId) throw new EnrollmentError(403, "worker_binding_mismatch", "Join token is bound to a different workerId");
    if (token.environmentId && token.environmentId !== request.environmentId) throw new EnrollmentError(403, "environment_binding_mismatch", "Join token is bound to a different environmentId");

    const registry = await this.memberships.read();
    if (registry.workers.some((worker) => worker.workerId === request.workerId)) throw new EnrollmentError(409, "worker_already_joined", "workerId is already enrolled");
    if (registry.workers.some((worker) => worker.environmentId === request.environmentId)) throw new EnrollmentError(409, "environment_already_joined", "environmentId is already enrolled");
    if ([...this.provisional.values()].some((join) => join.workerId === request.workerId)) throw new EnrollmentError(409, "worker_join_in_progress", "workerId already has a join transaction in progress");
    if ([...this.provisional.values()].some((join) => join.environmentId === request.environmentId)) throw new EnrollmentError(409, "environment_join_in_progress", "environmentId already has a join transaction in progress");

    for (const transport of request.transports) {
      const transportKey = gatewayVisibleTransportKey(transport);
      if (transportKey && registry.workers.some((worker) => worker.transports.some((existing) => gatewayVisibleTransportKey(existing) === transportKey))) {
        throw new EnrollmentError(409, "worker_transport_conflict", "Gateway-visible Worker transport endpoint is already enrolled");
      }
    }

    const transactionId = randomUUID();
    const credential = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 30_000;
    this.provisional.set(transactionId, { transactionId, workerId: request.workerId, environmentId: request.environmentId, transports: request.transports, credential, expiresAt });
    return { transactionId, credential, confirmBy: new Date(expiresAt).toISOString() };
  }

  async authenticateWorkerSession(rawHello: WorkerHelloV3, credential: string): Promise<WorkerSessionAuthentication> {
    this.purge();
    const hello = workerHelloV3Schema.parse(rawHello);
    if (Buffer.byteLength(credential) < 32) throw new EnrollmentError(401, "worker_session_unauthorized", "Worker session credential is invalid");

    const registry = await this.memberships.read();
    const membership = registry.workers.find((worker) => worker.workerId === hello.workerId && worker.environmentId === hello.environmentId);
    if (membership) {
      for (const reference of membership.credentialRefs) {
        if (reference.kind !== "secret-file") continue;
        try {
          const persisted = (await readFile(reference.path, "utf8")).trim();
          if (Buffer.byteLength(persisted) >= 32 && safeEqual(credential, persisted)) {
            // Session authentication proves Worker identity; membership transports decide whether
            // the session is routable. This permits a reverse session to be staged before an
            // authenticated HTTP?HTTP+gRPC protocol update commits.
            return { kind: "membership" };
          }
        } catch { /* try the next credential reference */ }
      }
    }

    const provisional = [...this.provisional.values()].find((candidate) =>
      candidate.transports.some((transport) => transport.type === "grpc")
      && candidate.workerId === hello.workerId
      && candidate.environmentId === hello.environmentId
      && safeEqual(candidate.credential, credential));
    if (provisional) return { kind: "provisional", transactionId: provisional.transactionId };

    throw new EnrollmentError(401, "worker_session_unauthorized", "Worker session is not authorized for this identity");
  }

  async confirmJoin(transactionId: string, credential: string): Promise<WorkerMembership> {
    this.purge();
    const join = this.provisional.get(transactionId);
    if (!join) throw new EnrollmentError(410, "join_transaction_expired", "Join transaction is absent or expired");
    if (join.expiresAt <= Date.now()) {
      this.provisional.delete(transactionId);
      this.sessions?.detachProvisional(transactionId, new Error("Worker join transaction expired"));
      throw new EnrollmentError(410, "join_transaction_expired", "Join transaction expired after 30 seconds");
    }
    if (!safeEqual(credential, join.credential)) {
      this.provisional.delete(transactionId);
      this.sessions?.detachProvisional(transactionId, new Error("Worker join confirmation credential mismatch"));
      throw new EnrollmentError(401, "invalid_provisional_credential", "Provisional credential does not match the transaction");
    }

    let credentialFile: string | undefined;
    let membershipCommitted = false;
    try {
      await this.verifyWorker(join);
      credentialFile = await this.persistCredential(join.workerId, join.credential);
      const membership: WorkerMembership = workerMembershipSchema.parse({ workerId: join.workerId, environmentId: join.environmentId, transports: join.transports, credentialRefs: [{ kind: "secret-file", path: credentialFile }] });
      await this.memberships.add(membership);
      membershipCommitted = true;
      if (join.transports.some((transport) => transport.type === "grpc")) {
        if (!this.sessions) throw new EnrollmentError(500, "worker_session_registry_unavailable", "Worker session registry is unavailable");
        this.sessions.promote(join.workerId, transactionId);
      }
      this.provisional.delete(transactionId);
      return membership;
    } catch (error) {
      this.provisional.delete(transactionId);
      if (membershipCommitted) await this.memberships.remove(join.workerId).catch(() => undefined);
      if (credentialFile) await rm(credentialFile, { force: true }).catch(() => undefined);
      this.sessions?.detachProvisional(transactionId, new Error("Worker join transaction failed"));
      throw error;
    }
  }

  async updateTransports(workerId: string, rawTransports: unknown): Promise<WorkerMembership> {
    const transports = z.array(workerTransportDescriptorSchema).min(1).max(8).parse(rawTransports);
    const registry = await this.memberships.read();
    const existing = registry.workers.find((worker) => worker.workerId === workerId);
    if (!existing) throw new EnrollmentError(404, "worker_not_found", "Worker membership was not found");
    for (const transport of transports) {
      const transportKey = gatewayVisibleTransportKey(transport);
      if (transportKey && registry.workers.some((worker) => worker.workerId !== workerId && worker.transports.some((candidate) => gatewayVisibleTransportKey(candidate) === transportKey))) {
        throw new EnrollmentError(409, "worker_transport_conflict", "Gateway-visible Worker transport endpoint is already enrolled");
      }
    }
    const reference = existing.credentialRefs[0];
    if (!reference || reference.kind !== "secret-file") throw new EnrollmentError(500, "worker_credential_unavailable", "Worker credential reference is unavailable");
    const credential = (await readFile(reference.path, "utf8")).trim();
    if (Buffer.byteLength(credential) < 32) throw new EnrollmentError(500, "worker_credential_unavailable", "Worker credential is invalid");
    const changedTransports = transports.filter((transport) => !existing.transports.some((candidate) =>
      candidate.type === transport.type
      && (transport.type === "grpc" || (candidate.type === "http" && candidate.endpoint === transport.endpoint))));
    if (changedTransports.length) {
      await this.verifyWorker({ transactionId: "management-update", workerId: existing.workerId, environmentId: existing.environmentId, transports: changedTransports, credential, expiresAt: Date.now() + 30_000 });
    }
    const updated = await this.memberships.updateTransports(existing.workerId, transports);
    return updated.workers.find((worker) => worker.workerId === existing.workerId)!;
  }

  async updateTransport(workerId: string, rawTransport: unknown): Promise<WorkerMembership> {
    return this.updateTransports(workerId, [workerTransportDescriptorSchema.parse(rawTransport)]);
  }

  authorizeJoinToken(tokenValue: string): void {
    this.purge();
    if (Buffer.byteLength(tokenValue) < 32) throw new EnrollmentError(401, "invalid_join_token", "Join token is invalid or expired");
    const token = this.joinTokens.get(digest(tokenValue));
    if (!token || token.expiresAt <= Date.now()) throw new EnrollmentError(401, "invalid_join_token", "Join token is invalid or expired");
  }

  async authenticateMembership(workerId: string, credential: string): Promise<WorkerMembership> {
    if (Buffer.byteLength(credential) < 32) throw new EnrollmentError(401, "worker_membership_unauthorized", "Worker membership credential is invalid");
    const registry = await this.memberships.read();
    const membership = registry.workers.find((worker) => worker.workerId === workerId);
    if (!membership) throw new EnrollmentError(401, "worker_membership_unauthorized", "Worker membership was not found");
    for (const reference of membership.credentialRefs) {
      if (reference.kind !== "secret-file") continue;
      try {
        const persisted = (await readFile(reference.path, "utf8")).trim();
        if (Buffer.byteLength(persisted) >= 32 && safeEqual(credential, persisted)) return membership;
      } catch { /* try next credential */ }
    }
    throw new EnrollmentError(401, "worker_membership_unauthorized", "Worker membership credential is invalid");
  }

  private async verifyWorker(join: ProvisionalJoin): Promise<void> {
    for (const transport of join.transports) {
      await this.verifyTransport(join, transport);
    }
  }

  private async verifyTransport(join: ProvisionalJoin, transport: WorkerTransportDescriptor): Promise<void> {
    if (transport.type === "grpc") {
      if (!this.sessions) throw new EnrollmentError(502, "worker_session_unavailable", "Worker reverse session registry is unavailable");
      let session;
      try { session = this.sessions.require(join.workerId); }
      catch { throw new EnrollmentError(502, "worker_session_unavailable", "Worker has no active reverse gRPC session"); }
      if (session.environmentId !== join.environmentId) throw new EnrollmentError(409, "worker_identity_mismatch", "Worker session environment does not match the enrollment transaction");
      if (join.transactionId === "management-update") {
        if (session.authentication.kind !== "membership") throw new EnrollmentError(409, "worker_session_auth_mismatch", "Worker session is not authenticated by existing membership");
      } else if (session.authentication.kind !== "provisional" || session.authentication.transactionId !== join.transactionId) {
        throw new EnrollmentError(409, "worker_session_auth_mismatch", "Worker session is not bound to this enrollment transaction");
      }

      const signal = AbortSignal.timeout(5_000);
      try {
        const health = await session.transport.execute<{ ok?: unknown }>({ operation: "health" }, signal);
        if (health.ok !== true) throw new EnrollmentError(502, "worker_health_failed", "Worker reverse-session health probe failed");
        const hello = workerHelloV3Schema.parse(await session.transport.execute<unknown>({ operation: "hello" }, signal));
        if (hello.workerId !== join.workerId || hello.environmentId !== join.environmentId) throw new EnrollmentError(409, "worker_handshake_mismatch", "Worker reverse-session handshake does not match the enrollment transaction");
        if (hello.protocolVersion !== QUEQIAO_WORKER_PROTOCOL_VERSION) throw new EnrollmentError(409, "worker_protocol_mismatch", "Worker Protocol is incompatible with this Gateway");
        return;
      } catch (error) {
        if (error instanceof EnrollmentError) throw error;
        throw new EnrollmentError(502, "worker_unreachable", error instanceof Error ? error.message : "Worker reverse-session enrollment probe failed");
      }
    }

    const endpoint = new URL(transport.endpoint);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    timeout.unref?.();
    try {
      const health = await fetch(new URL("health", endpoint), { signal: controller.signal });
      if (!health.ok) throw new EnrollmentError(502, "worker_health_failed", `Worker health probe failed with HTTP ${health.status}`);
      const headers = { "x-queqiao-worker-token": join.credential };
      const identityResponse = await fetch(new URL("enrollment/identity", endpoint), { headers, signal: controller.signal });
      if (!identityResponse.ok) throw new EnrollmentError(502, "worker_identity_failed", `Worker identity probe failed with HTTP ${identityResponse.status}`);
      const identity = z.object({ workerId: z.uuid(), environmentId: z.string(), protocolVersion: z.string() }).parse(await identityResponse.json());
      if (identity.workerId !== join.workerId || identity.environmentId !== join.environmentId) throw new EnrollmentError(409, "worker_identity_mismatch", "Worker identity does not match the enrollment transaction");
      if (identity.protocolVersion !== QUEQIAO_WORKER_PROTOCOL_VERSION) throw new EnrollmentError(409, "worker_protocol_mismatch", "Worker Protocol is incompatible with this Gateway");
      const helloResponse = await fetch(new URL("v1/hello", endpoint), { headers, signal: controller.signal });
      if (!helloResponse.ok) throw new EnrollmentError(502, "worker_handshake_failed", `Worker handshake failed with HTTP ${helloResponse.status}`);
      const hello = workerHelloV3Schema.parse(await helloResponse.json());
      if (hello.workerId !== join.workerId || hello.environmentId !== join.environmentId) throw new EnrollmentError(409, "worker_handshake_mismatch", "Worker handshake does not match the enrollment transaction");
    } catch (error) {
      if (error instanceof EnrollmentError) throw error;
      throw new EnrollmentError(502, "worker_unreachable", error instanceof Error ? error.message : "Worker enrollment probe failed");
    } finally {
      clearTimeout(timeout);
    }
  }

  private async persistCredential(workerId: string, credential: string): Promise<string> {
    const directory = path.join(this.stateDirectory, "worker-credentials");
    await secureRuntimeDirectory(directory);
    const file = path.join(directory, `${workerId}-${randomUUID()}.secret`);
    const handle = await open(file, "wx", 0o600);
    try { await handle.writeFile(`${credential}\n`, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await secureRuntimeFile(file);
    return file;
  }
}
