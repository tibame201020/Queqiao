import { readFile } from "node:fs/promises";
import path from "node:path";
import { readRuntimeConfig } from "@queqiao/config";
import type { WorkerProtocolService } from "./worker-protocol-service.js";
import { WorkerReverseSessionManager, type PersistentReverseSession } from "./reverse-session-manager.js";

type Activation = { gateway?: string; target: string; credential: string; security?: "tls" | "loopback"; caCertificate?: string };

export class WorkerGatewaySessionManager {
  private readonly managers = new Map<string, WorkerReverseSessionManager>();
  private readonly discoveredConnections = new Map<string, PersistentReverseSession>();

  constructor(private readonly configFile: string, private readonly service: WorkerProtocolService) {}

  private key(gateway?: string): string { return gateway ? new URL(gateway).href : "legacy"; }

  private manager(gateway?: string): WorkerReverseSessionManager {
    const key = this.key(gateway);
    let manager = this.managers.get(key);
    if (manager) return manager;
    manager = new WorkerReverseSessionManager({
      service: this.service,
      credential: { current: async () => {
        if (key === "legacy") throw new Error("Legacy reverse-session credential is unavailable");
        const runtime = await readRuntimeConfig(this.configFile);
        const membership = runtime.worker?.memberships.find((entry) => entry.gateway === key);
        if (!membership) throw new Error(`Worker Gateway membership is unavailable: ${key}`);
        return (await readFile(path.resolve(membership.credentialRef.path), "utf8")).trim();
      } },
      loadPersistent: async (): Promise<PersistentReverseSession | undefined> => {
        if (key === "legacy") return undefined;
        const discovered = this.discoveredConnections.get(key);
        if (discovered) return discovered;
        const runtime = await readRuntimeConfig(this.configFile);
        const grpc = runtime.worker?.memberships.find((entry) => entry.gateway === key)?.protocols.grpc;
        if (!grpc) return undefined;
        const caCertificate = grpc.caCertificateFile ? await readFile(path.resolve(grpc.caCertificateFile), "utf8") : undefined;
        return { target: grpc.target, security: grpc.security, ...(caCertificate ? { caCertificate } : {}) };
      },
    });
    this.managers.set(key, manager);
    return manager;
  }

  async activate(input: Activation): Promise<void> {
    await this.manager(input.gateway).activate({ target: input.target, credential: input.credential, ...(input.security ? { security: input.security } : {}), ...(input.caCertificate ? { caCertificate: input.caCertificate } : {}) });
  }

  deactivate(gateway: string): void {
    const key = this.key(gateway);
    const manager = this.managers.get(key);
    manager?.close();
    this.managers.delete(key);
    this.discoveredConnections.delete(key);
  }

  async startPersistent(): Promise<void> {
    const runtime = await readRuntimeConfig(this.configFile);
    if (!runtime.worker?.workerId) return;
    await Promise.all((runtime.worker.memberships ?? []).map(async (membership) => {
      const credential = (await readFile(path.resolve(membership.credentialRef.path), "utf8")).trim();
      const authoritative = await this.discoverGrpc(membership.gateway, runtime.worker!.workerId!, credential).catch(() => undefined);
      if (authoritative === null) {
        this.discoveredConnections.delete(membership.gateway);
        this.deactivate(membership.gateway);
        return;
      }
      if (authoritative) this.discoveredConnections.set(membership.gateway, authoritative);
      else if (!membership.protocols.grpc) return;
      await this.manager(membership.gateway).startPersistent();
    }));
  }

  async reconcileMembershipTransports(localPort: number): Promise<void> {
    const runtime = await readRuntimeConfig(this.configFile);
    if (!runtime.worker?.workerId) return;
    await Promise.all((runtime.worker.memberships ?? []).map(async (membership) => {
      const credential = (await readFile(path.resolve(membership.credentialRef.path), "utf8")).trim();
      const response = await fetch(new URL(`enrollment/protocols?workerId=${encodeURIComponent(runtime.worker!.workerId!)}`, membership.gateway), {
        headers: { "x-queqiao-worker-token": credential },
        signal: AbortSignal.timeout(5_000),
      });
      if (!response.ok) throw new Error(`Gateway protocol discovery returned HTTP ${response.status}`);
      const body = await response.json() as { enabled?: unknown };
      const enabled = Array.isArray(body.enabled) ? body.enabled.filter((value): value is string => typeof value === "string") : [];
      if (!enabled.length) return;
      if (enabled.some((type) => type !== "http" && type !== "grpc")) return;
      const transports = enabled.map((type) => type === "http"
        ? { type: "http" as const, endpoint: `http://127.0.0.1:${localPort}/` }
        : { type: "grpc" as const, mode: "reverse" as const });
      const update = await fetch(new URL("enrollment/protocols", membership.gateway), {
        method: "PUT",
        headers: { "content-type": "application/json", "x-queqiao-worker-token": credential },
        body: JSON.stringify({ workerId: runtime.worker!.workerId, transports }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!update.ok) {
        const failure = await update.json().catch(() => ({})) as { error?: unknown; message?: unknown };
        throw new Error(`${typeof failure.error === "string" ? failure.error : "protocol_reconciliation_failed"}: ${typeof failure.message === "string" ? failure.message : `HTTP ${update.status}`}`);
      }
    }));
  }

  private async discoverGrpc(gateway: string, workerId: string, credential: string): Promise<PersistentReverseSession | null> {
    const response = await fetch(new URL(`enrollment/protocols?workerId=${encodeURIComponent(workerId)}`, gateway), {
      headers: { "x-queqiao-worker-token": credential },
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Gateway protocol discovery returned HTTP ${response.status}`);
    const body = await response.json() as { enabled?: unknown; protocols?: unknown };
    const enabled = Array.isArray(body.enabled) ? body.enabled : [];
    if (!enabled.includes("grpc")) return null;
    if (!Array.isArray(body.protocols)) throw new Error("Gateway protocol discovery returned invalid protocols");
    const offer = body.protocols.find((entry) => entry && typeof entry === "object" && (entry as { type?: unknown }).type === "grpc") as { capable?: unknown; connection?: { target?: unknown; security?: unknown; caCertificate?: unknown } } | undefined;
    if (!offer || offer.capable !== true || !offer.connection || typeof offer.connection.target !== "string") throw new Error("Gateway has gRPC enabled but no usable gRPC capability");
    const security = offer.connection.security === "loopback" ? "loopback" : "tls";
    if (security === "tls" && typeof offer.connection.caCertificate !== "string") throw new Error("Gateway gRPC TLS capability is missing CA material");
    return { target: offer.connection.target, security, ...(typeof offer.connection.caCertificate === "string" ? { caCertificate: offer.connection.caCertificate } : {}) };
  }

  close(): void { for (const manager of this.managers.values()) manager.close(); }
}
