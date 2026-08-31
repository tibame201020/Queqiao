import * as grpc from "@grpc/grpc-js";
import {
  MAX_WORKER_SESSION_FRAME_BYTES,
  QUEQIAO_WORKER_GRPC_SERVICE_NAME,
  workerGrpcServiceDefinition,
  workerSessionReadyFrameSchema,
  type WorkerSessionFrame,
} from "@queqiao/worker-protocol";
import { ReverseWorkerSession } from "./reverse-worker-session.js";
import type { WorkerProtocolService } from "./worker-protocol-service.js";

const WORKER_CREDENTIAL_METADATA = "x-queqiao-worker-token";

type GenericWorkerSessionClient = grpc.Client & {
  connect(metadata: grpc.Metadata): grpc.ClientDuplexStream<WorkerSessionFrame, WorkerSessionFrame>;
};

type GenericWorkerSessionClientConstructor = new (
  address: string,
  credentials: grpc.ChannelCredentials,
  options?: grpc.ClientOptions,
) => GenericWorkerSessionClient;

const WorkerSessionClient = grpc.makeGenericClientConstructor(
  workerGrpcServiceDefinition as grpc.ServiceDefinition,
  QUEQIAO_WORKER_GRPC_SERVICE_NAME,
) as unknown as GenericWorkerSessionClientConstructor;

export type WorkerGrpcReverseClientConfig = {
  target: string;
  credential: string;
  service: WorkerProtocolService;
  maxInFlight?: number;
  readyTimeoutMs?: number;
  onDisconnect?: (error: Error) => void;
};

function assertLoopbackTarget(target: string): void {
  let hostname: string;
  try { hostname = new URL(`http://${target}`).hostname; }
  catch { throw new Error("Worker gRPC target must be host:port"); }
  if (!["127.0.0.1", "localhost", "::1", "[::1]"].includes(hostname)) {
    throw new Error("Insecure Worker gRPC is restricted to loopback; remote transport requires TLS");
  }
}

export class WorkerGrpcReverseClient {
  private client: GenericWorkerSessionClient | undefined;
  private call: grpc.ClientDuplexStream<WorkerSessionFrame, WorkerSessionFrame> | undefined;
  private session: ReverseWorkerSession | undefined;
  private connected = false;
  private intentionalClose = false;
  private disconnectReported = false;

  constructor(private readonly config: WorkerGrpcReverseClientConfig) {
    if (Buffer.byteLength(config.credential) < 32) throw new Error("Worker gRPC credential is invalid");
    const readyTimeoutMs = config.readyTimeoutMs ?? 5_000;
    if (!Number.isInteger(readyTimeoutMs) || readyTimeoutMs < 100 || readyTimeoutMs > 30_000) throw new Error("Worker gRPC readyTimeoutMs must be between 100 and 30000");
  }

  connectLoopback(): Promise<void> {
    assertLoopbackTarget(this.config.target);
    return this.connect(grpc.credentials.createInsecure());
  }

  connectTls(caCertificate: string | Buffer): Promise<void> {
    const ca = Buffer.isBuffer(caCertificate) ? caCertificate : Buffer.from(caCertificate, "utf8");
    if (ca.length < 64 || !ca.toString("utf8").includes("BEGIN CERTIFICATE")) throw new Error("Worker gRPC CA certificate is invalid");
    return this.connect(grpc.credentials.createSsl(ca));
  }

  private async connect(channelCredentials: grpc.ChannelCredentials): Promise<void> {
    if (this.connected || this.client) throw new Error("Worker gRPC reverse client is already connected");
    this.intentionalClose = false;
    this.disconnectReported = false;
    const client = new WorkerSessionClient(
      this.config.target,
      channelCredentials,
      {
        "grpc.max_receive_message_length": MAX_WORKER_SESSION_FRAME_BYTES,
        "grpc.max_send_message_length": MAX_WORKER_SESSION_FRAME_BYTES,
      },
    );
    const metadata = new grpc.Metadata();
    metadata.set(WORKER_CREDENTIAL_METADATA, this.config.credential);
    const call = client.connect(metadata);
    const session = new ReverseWorkerSession({
      service: this.config.service,
      ...(this.config.maxInFlight ? { maxInFlight: this.config.maxInFlight } : {}),
      send: (frame) => {
        if (call.destroyed) throw new Error("Worker gRPC stream is closed");
        if (!call.write(frame)) throw new Error("Worker gRPC stream backpressure limit reached");
      },
    });

    this.client = client;
    this.call = call;
    this.session = session;
    let readyResolve!: () => void;
    let readyReject!: (error: Error) => void;
    let readySettled = false;
    const ready = new Promise<void>((resolve, reject) => {
      readyResolve = () => { if (!readySettled) { readySettled = true; resolve(); } };
      readyReject = (error) => { if (!readySettled) { readySettled = true; reject(error); } };
    });
    const readyTimeout = setTimeout(() => readyReject(new Error("Worker gRPC session ready acknowledgment timed out")), this.config.readyTimeoutMs ?? 5_000);
    readyTimeout.unref?.();
    const reportDisconnect = (error: Error) => {
      if (this.disconnectReported || this.intentionalClose) return;
      this.disconnectReported = true;
      this.connected = false;
      this.config.onDisconnect?.(error);
    };
    call.on("data", (frame: WorkerSessionFrame) => {
      const readyFrame = workerSessionReadyFrameSchema.safeParse(frame);
      if (readyFrame.success) {
        readyResolve();
        return;
      }
      void session.receive(frame).catch((error) => {
        const normalized = error instanceof Error ? error : new Error("Worker gRPC request failed");
        readyReject(normalized);
        session.close(normalized);
        call.cancel();
        reportDisconnect(normalized);
      });
    });
    call.on("error", (error) => { readyReject(error); session.close(error); reportDisconnect(error); });
    call.on("close", () => {
      const error = new Error("Worker gRPC stream closed");
      readyReject(error);
      session.close(error);
      reportDisconnect(error);
    });

    try {
      await session.open();
      await ready;
      clearTimeout(readyTimeout);
      this.connected = true;
    } catch (error) {
      clearTimeout(readyTimeout);
      const normalized = error instanceof Error ? error : new Error("Worker gRPC connection failed");
      session.close(normalized);
      call.cancel();
      client.close();
      this.client = undefined;
      this.call = undefined;
      this.session = undefined;
      throw normalized;
    }
  }

  close(): void {
    this.intentionalClose = true;
    this.connected = false;
    this.session?.close();
    this.call?.cancel();
    this.client?.close();
    this.session = undefined;
    this.call = undefined;
    this.client = undefined;
  }
}