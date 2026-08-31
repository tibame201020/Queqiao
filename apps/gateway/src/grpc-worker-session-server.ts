import * as grpc from "@grpc/grpc-js";
import {
  MAX_WORKER_SESSION_FRAME_BYTES,
  workerGrpcServiceDefinition,
  workerSessionConnectFrameSchema,
  type WorkerHelloV3,
  type WorkerSessionFrame,
} from "@queqiao/worker-protocol";
import { ReverseWorkerTransport } from "./reverse-worker-transport.js";
import { WorkerSessionRegistry, type WorkerSessionAuthentication } from "./worker-session-registry.js";

const WORKER_CREDENTIAL_METADATA = "x-queqiao-worker-token";

export type WorkerGrpcSessionServerConfig = {
  sessions: WorkerSessionRegistry;
  authenticate(hello: WorkerHelloV3, credential: string): Promise<WorkerSessionAuthentication> | WorkerSessionAuthentication;
};

function serviceError(code: grpc.status, message: string): grpc.ServiceError {
  return Object.assign(new Error(message), { code, details: message, metadata: new grpc.Metadata() });
}

function credentialFrom(call: grpc.ServerDuplexStream<WorkerSessionFrame, WorkerSessionFrame>): string {
  const values = call.metadata.get(WORKER_CREDENTIAL_METADATA);
  if (values.length !== 1 || typeof values[0] !== "string" || Buffer.byteLength(values[0]) < 32) {
    throw serviceError(grpc.status.UNAUTHENTICATED, "Worker session credential is missing or invalid");
  }
  return values[0];
}

export class WorkerGrpcSessionServer {
  private readonly server: grpc.Server;
  private listening = false;

  constructor(private readonly config: WorkerGrpcSessionServerConfig) {
    this.server = new grpc.Server({
      "grpc.max_receive_message_length": MAX_WORKER_SESSION_FRAME_BYTES,
      "grpc.max_send_message_length": MAX_WORKER_SESSION_FRAME_BYTES,
    });
    this.server.addService(workerGrpcServiceDefinition as grpc.ServiceDefinition, {
      connect: (call: grpc.ServerDuplexStream<WorkerSessionFrame, WorkerSessionFrame>) => this.handleConnect(call),
    });
  }

  async listenLoopback(port = 0): Promise<string> {
    if (this.listening) throw new Error("Worker gRPC session server is already listening");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Worker gRPC loopback port must be between 0 and 65535");
    const boundPort = await new Promise<number>((resolve, reject) => {
      this.server.bindAsync(`127.0.0.1:${port}`, grpc.ServerCredentials.createInsecure(), (error, actualPort) => error ? reject(error) : resolve(actualPort));
    });
    this.listening = true;
    return `127.0.0.1:${boundPort}`;
  }

  async listenTls(host: string, port: number, cert: Buffer, key: Buffer): Promise<string> {
    if (this.listening) throw new Error("Worker gRPC session server is already listening");
    if (!host.trim()) throw new Error("Worker gRPC TLS host is required");
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("Worker gRPC TLS port must be between 0 and 65535");
    if (!cert.toString("utf8").includes("BEGIN CERTIFICATE")) throw new Error("Worker gRPC TLS certificate is invalid");
    if (!key.toString("utf8").includes("PRIVATE KEY")) throw new Error("Worker gRPC TLS private key is invalid");
    const credentials = grpc.ServerCredentials.createSsl(null, [{ cert_chain: cert, private_key: key }], false);
    const boundPort = await new Promise<number>((resolve, reject) => {
      this.server.bindAsync(`${host}:${port}`, credentials, (error, actualPort) => error ? reject(error) : resolve(actualPort));
    });
    this.listening = true;
    return `${host}:${boundPort}`;
  }

  async close(): Promise<void> {
    if (!this.listening) return;
    this.listening = false;
    await new Promise<void>((resolve) => this.server.tryShutdown(() => resolve()));
  }

  private handleConnect(call: grpc.ServerDuplexStream<WorkerSessionFrame, WorkerSessionFrame>): void {
    let sessionId: string | undefined;
    let transport: ReverseWorkerTransport | undefined;
    let failed = false;
    let processing = Promise.resolve();

    const detach = (reason: Error) => {
      if (!sessionId) return;
      this.config.sessions.detach(sessionId, reason);
      sessionId = undefined;
    };
    const fail = (error: unknown, code = grpc.status.FAILED_PRECONDITION) => {
      if (failed) return;
      failed = true;
      const normalized = error && typeof error === "object" && "code" in error && typeof (error as { code?: unknown }).code === "number"
        ? error as grpc.ServiceError
        : serviceError(code, error instanceof Error ? error.message : "Worker gRPC session failed");
      detach(normalized);
      call.destroy(normalized);
    };

    call.on("data", (raw: WorkerSessionFrame) => {
      processing = processing.then(async () => {
        if (failed) return;
        if (!transport) {
          const connect = workerSessionConnectFrameSchema.safeParse(raw);
          if (!connect.success) throw serviceError(grpc.status.FAILED_PRECONDITION, "First Worker gRPC frame must be connect");
          const credential = credentialFrom(call);
          let authentication: WorkerSessionAuthentication;
          try { authentication = await this.config.authenticate(connect.data.hello, credential); }
          catch { throw serviceError(grpc.status.UNAUTHENTICATED, "Worker session authentication failed"); }
          transport = new ReverseWorkerTransport({
            send: (frame) => {
              if (failed || call.destroyed) throw new Error("Worker gRPC session is closed");
              if (!call.write(frame)) throw new Error("Worker gRPC session backpressure limit reached");
            },
            close: () => {
              if (!call.destroyed) call.destroy();
            },
          });
          sessionId = this.config.sessions.attach(connect.data.hello, transport, authentication).sessionId;
          if (!call.write({ kind: "ready", sessionId })) throw serviceError(grpc.status.RESOURCE_EXHAUSTED, "Worker gRPC session ready acknowledgment backpressure limit reached");
          return;
        }
        if (raw.kind !== "response" && raw.kind !== "error") throw serviceError(grpc.status.FAILED_PRECONDITION, `Unexpected Worker-to-Gateway frame: ${raw.kind}`);
        transport.receive(raw);
      }).catch((error) => fail(error));
    });
    call.on("error", (error) => { detach(error instanceof Error ? error : new Error("Worker gRPC stream error")); });
    call.on("end", () => { detach(new Error("Worker gRPC stream ended")); call.end(); });
    call.on("close", () => { detach(new Error("Worker gRPC stream closed")); });
  }
}
