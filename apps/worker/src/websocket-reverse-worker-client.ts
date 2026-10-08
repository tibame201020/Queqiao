import {
  MAX_WORKER_SESSION_FRAME_BYTES,
  workerSessionFrameSchema,
  workerSessionReadyFrameSchema,
  type WorkerSessionFrame,
} from "@queqiao/worker-protocol";
import WebSocket, { type RawData } from "ws";
import { ReverseWorkerSession } from "./reverse-worker-session.js";
import type { WorkerProtocolService } from "./worker-protocol-service.js";

export type WorkerWebSocketReverseClientConfig = {
  url: string;
  credential: string;
  service: WorkerProtocolService;
  readyTimeoutMs?: number;
  onDisconnect?(): void;
};

function parseMessage(raw: RawData): WorkerSessionFrame {
  const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
  if (bytes.byteLength > MAX_WORKER_SESSION_FRAME_BYTES) throw new Error("Worker WebSocket session frame is too large");
  let parsed: unknown;
  try { parsed = JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Worker WebSocket session frame is not valid JSON"); }
  return workerSessionFrameSchema.parse(parsed);
}

export class WorkerWebSocketReverseClient {
  private socket: WebSocket | undefined;
  private session: ReverseWorkerSession | undefined;
  private closing = false;

  constructor(private readonly config: WorkerWebSocketReverseClientConfig) {
    const url = new URL(config.url);
    if (url.protocol !== "ws:" && url.protocol !== "wss:") throw new Error("Worker WebSocket URL must use ws or wss");
    if (Buffer.byteLength(config.credential) < 32) throw new Error("Worker WebSocket credential is invalid");
  }

  async connect(): Promise<void> {
    if (this.socket) throw new Error("Worker WebSocket reverse client is already active");
    this.closing = false;
    const readyTimeoutMs = this.config.readyTimeoutMs ?? 10_000;
    const socket = new WebSocket(this.config.url, { maxPayload: MAX_WORKER_SESSION_FRAME_BYTES });
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let authenticated = false;
      const timer = setTimeout(() => finish(new Error("Worker WebSocket ready acknowledgment timed out")), readyTimeoutMs);
      timer.unref?.();

      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (error) reject(error); else resolve();
      };

      const session = new ReverseWorkerSession({
        service: this.config.service,
        send: (frame) => {
          if (socket.readyState !== WebSocket.OPEN) throw new Error("Worker WebSocket session is not open");
          if (!authenticated) {
            if (frame.kind !== "connect") throw new Error("First Worker WebSocket frame must be connect");
            authenticated = true;
            socket.send(JSON.stringify({ kind: "authenticate", credential: this.config.credential, connect: frame }));
            return;
          }
          socket.send(JSON.stringify(frame));
        },
      });
      this.session = session;

      socket.once("open", () => { void session.open().catch((error) => finish(error instanceof Error ? error : new Error(String(error)))); });
      socket.on("message", (raw) => {
        try {
          const frame = parseMessage(raw);
          const ready = workerSessionReadyFrameSchema.safeParse(frame);
          if (ready.success) {
            finish();
            return;
          }
          void session.receive(frame).catch((error) => {
            finish(error instanceof Error ? error : new Error(String(error)));
            socket.close(1002, "Invalid Worker session frame");
          });
        } catch (error) {
          finish(error instanceof Error ? error : new Error(String(error)));
          socket.close(1002, "Invalid Worker session frame");
        }
      });
      socket.once("error", (error) => finish(error instanceof Error ? error : new Error("Worker WebSocket connection failed")));
      socket.once("close", () => {
        session.close(new Error("Worker WebSocket session closed"));
        this.session = undefined;
        this.socket = undefined;
        if (!settled) finish(new Error("Worker WebSocket session closed before ready"));
        if (!this.closing) this.config.onDisconnect?.();
      });
    });
  }

  close(): void {
    this.closing = true;
    this.session?.close();
    this.session = undefined;
    const socket = this.socket;
    this.socket = undefined;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) socket.close(1000, "Worker closing");
  }
}