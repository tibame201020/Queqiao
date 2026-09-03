import { WorkerGrpcReverseClient, type WorkerGrpcReverseClientConfig } from "./grpc-reverse-worker-client.js";
import type { WorkerProtocolService } from "./worker-protocol-service.js";

export type PersistentReverseSession = { target: string; security?: "tls" | "loopback"; caCertificate?: string };

type CredentialSource = { current(): Promise<string> };
type ReverseClient = Pick<WorkerGrpcReverseClient, "connectTls" | "connectLoopback" | "close">;
type ReverseClientFactory = (config: WorkerGrpcReverseClientConfig) => ReverseClient;

export type WorkerReverseSessionManagerConfig = {
  service: WorkerProtocolService;
  credential: CredentialSource;
  loadPersistent(): Promise<PersistentReverseSession | undefined>;
  createClient?: ReverseClientFactory;
  random?: () => number;
};

export class WorkerReverseSessionManager {
  private current: ReverseClient | undefined;
  private reconnectTimer: NodeJS.Timeout | undefined;
  private reconnectAttempt = 0;
  private stopped = false;
  private readonly createClient: ReverseClientFactory;
  private readonly random: () => number;

  constructor(private readonly config: WorkerReverseSessionManagerConfig) {
    this.createClient = config.createClient ?? ((clientConfig) => new WorkerGrpcReverseClient(clientConfig));
    this.random = config.random ?? Math.random;
  }

  get connected(): boolean { return Boolean(this.current); }

  async activate(input: { target: string; credential: string; security?: "tls" | "loopback"; caCertificate?: string }): Promise<void> {
    this.cancelReconnect();
    this.current?.close();
    this.current = undefined;
    const client = this.newClient(input.target, input.credential);
    this.current = client;
    try {
      await this.connectClient(client, input);
      this.reconnectAttempt = 0;
    } catch (error) {
      if (this.current === client) this.current = undefined;
      client.close();
      throw error;
    }
  }

  async startPersistent(): Promise<void> {
    if (this.stopped) return;
    const persistent = await this.config.loadPersistent();
    if (!persistent) return;
    try {
      await this.connectPersistent(persistent);
    } catch {
      await this.schedulePersistentReconnect();
    }
  }

  close(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.cancelReconnect();
    this.current?.close();
    this.current = undefined;
  }

  private newClient(target: string, credential: string): ReverseClient {
    let client!: ReverseClient;
    client = this.createClient({
      target,
      credential,
      service: this.config.service,
      onDisconnect: () => {
        if (this.current !== client) return;
        this.current = undefined;
        if (!this.stopped) void this.schedulePersistentReconnect();
      },
    });
    return client;
  }

  private async connectClient(client: ReverseClient, connection: { security?: "tls" | "loopback"; caCertificate?: string }): Promise<void> {
    if (connection.security === "loopback") return client.connectLoopback();
    if (!connection.caCertificate) throw new Error("Worker gRPC TLS CA certificate is required");
    return client.connectTls(connection.caCertificate);
  }

  private async connectPersistent(persistent: PersistentReverseSession): Promise<void> {
    if (this.stopped) return;
    this.current?.close();
    const credential = await this.config.credential.current();
    const client = this.newClient(persistent.target, credential);
    this.current = client;
    try {
      await this.connectClient(client, persistent);
      this.reconnectAttempt = 0;
    } catch (error) {
      if (this.current === client) this.current = undefined;
      client.close();
      throw error;
    }
  }

  private async schedulePersistentReconnect(): Promise<void> {
    if (this.stopped || this.reconnectTimer) return;
    const persistent = await this.config.loadPersistent();
    if (!persistent || this.stopped || this.reconnectTimer) return;
    const base = Math.min(30_000, 1_000 * 2 ** Math.min(this.reconnectAttempt, 5));
    const jitter = 0.8 + Math.max(0, Math.min(1, this.random())) * 0.4;
    const delay = Math.max(500, Math.round(base * jitter));
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 5);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = undefined;
      void this.connectPersistent(persistent).catch(() => this.schedulePersistentReconnect());
    }, delay);
    this.reconnectTimer.unref?.();
  }

  private cancelReconnect(): void {
    if (!this.reconnectTimer) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = undefined;
  }
}