import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { QUEQIAO_WORKER_PROTOCOL_VERSION, workerHelloV3Schema } from "@queqiao/worker-protocol";
import { secureRuntimeDirectory, secureRuntimeFile } from "@queqiao/platform-paths";
import { WorkerMembershipStore, workerMembershipSchema, workerTransportDescriptorSchema, type WorkerMembership, type WorkerTransportDescriptor } from "./worker-membership-store.js";

const joinStartSchema = z.object({
  token: z.string().min(32).max(256),
  workerId: z.uuid(),
  environmentId: z.string().min(1).max(64),
  transport: workerTransportDescriptorSchema,
});

export type JoinStartRequest = z.infer<typeof joinStartSchema>;
export type JoinTokenOptions = { expiresSeconds?: number; workerId?: string; environmentId?: string };

type JoinToken = { digest: string; expiresAt: number; workerId?: string; environmentId?: string };
type ProvisionalJoin = {
  transactionId: string;
  workerId: string;
  environmentId: string;
  transport: WorkerTransportDescriptor;
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

  constructor(readonly memberships: WorkerMembershipStore, readonly stateDirectory: string) {}

  private purge(now = Date.now()): void {
    for (const [key, token] of this.joinTokens) if (token.expiresAt <= now) this.joinTokens.delete(key);
    for (const [key, join] of this.provisional) if (join.expiresAt <= now) this.provisional.delete(key);
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
    this.joinTokens.delete(key); // presentation of a valid token starts and consumes the transaction authority
    if (token.expiresAt <= Date.now()) throw new EnrollmentError(401, "expired_join_token", "Join token has expired");
    if (token.workerId && token.workerId !== request.workerId) throw new EnrollmentError(403, "worker_binding_mismatch", "Join token is bound to a different workerId");
    if (token.environmentId && token.environmentId !== request.environmentId) throw new EnrollmentError(403, "environment_binding_mismatch", "Join token is bound to a different environmentId");
    const registry = await this.memberships.read();
    if (registry.workers.some((worker) => worker.workerId === request.workerId)) throw new EnrollmentError(409, "worker_already_joined", "workerId is already enrolled");
    if (registry.workers.some((worker) => worker.environmentId === request.environmentId)) throw new EnrollmentError(409, "environment_already_joined", "environmentId is already enrolled");
    const transactionId = randomUUID();
    const credential = randomBytes(32).toString("base64url");
    const expiresAt = Date.now() + 30_000;
    this.provisional.set(transactionId, { transactionId, workerId: request.workerId, environmentId: request.environmentId, transport: request.transport, credential, expiresAt });
    return { transactionId, credential, confirmBy: new Date(expiresAt).toISOString() };
  }

  async confirmJoin(transactionId: string, credential: string): Promise<WorkerMembership> {
    this.purge();
    const join = this.provisional.get(transactionId);
    if (!join) throw new EnrollmentError(410, "join_transaction_expired", "Join transaction is absent or expired");
    if (join.expiresAt <= Date.now()) { this.provisional.delete(transactionId); throw new EnrollmentError(410, "join_transaction_expired", "Join transaction expired after 30 seconds"); }
    if (!safeEqual(credential, join.credential)) {
      this.provisional.delete(transactionId);
      throw new EnrollmentError(401, "invalid_provisional_credential", "Provisional credential does not match the transaction");
    }
    try {
      await this.verifyWorker(join);
      const credentialFile = await this.persistCredential(join.workerId, join.credential);
      try {
        const membership: WorkerMembership = workerMembershipSchema.parse({ workerId: join.workerId, environmentId: join.environmentId, transport: join.transport, credentialRefs: [{ kind: "secret-file", path: credentialFile }] });
        await this.memberships.add(membership);
        this.provisional.delete(transactionId);
        return membership;
      } catch (error) {
        await rm(credentialFile, { force: true }).catch(() => undefined);
        throw error;
      }
    } catch (error) {
      this.provisional.delete(transactionId);
      throw error;
    }
  }

  async updateTransport(workerId: string, rawTransport: unknown): Promise<WorkerMembership> {
    const transport = workerTransportDescriptorSchema.parse(rawTransport);
    const registry = await this.memberships.read();
    const existing = registry.workers.find((worker) => worker.workerId === workerId);
    if (!existing) throw new EnrollmentError(404, "worker_not_found", "Worker membership was not found");
    const reference = existing.credentialRefs[0];
    if (!reference || reference.kind !== "secret-file") throw new EnrollmentError(500, "worker_credential_unavailable", "Worker credential reference is unavailable");
    const credential = (await readFile(reference.path, "utf8")).trim();
    if (Buffer.byteLength(credential) < 32) throw new EnrollmentError(500, "worker_credential_unavailable", "Worker credential is invalid");
    await this.verifyWorker({ transactionId: "management-update", workerId: existing.workerId, environmentId: existing.environmentId, transport, credential, expiresAt: Date.now() + 30_000 });
    const updated = await this.memberships.updateTransport(existing.workerId, transport);
    return updated.workers.find((worker) => worker.workerId === existing.workerId)!;
  }

  private async verifyWorker(join: ProvisionalJoin): Promise<void> {
    if (join.transport.type !== "http") throw new EnrollmentError(400, "unsupported_transport", "Unsupported Worker transport");
    const endpoint = new URL(join.transport.endpoint);
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
