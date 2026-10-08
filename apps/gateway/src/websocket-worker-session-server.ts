import type { Server as HttpServer, IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { createAuditEvent, type AuditSink } from "@queqiao/audit";
import {
  MAX_WORKER_SESSION_FRAME_BYTES,
  workerSessionAuthenticateFrameSchema,
  type WorkerHelloV3,
  type WorkerSessionFrame,
} from "@queqiao/worker-protocol";
import { WebSocketServer, WebSocket, type RawData } from "ws";
import { ReverseWorkerTransport } from "./reverse-worker-transport.js";
import { WorkerSessionRegistry, type WorkerSessionAuthentication } from "./worker-session-registry.js";

export type WorkerWebSocketSessionServerConfig = {
  sessions: WorkerSessionRegistry;
  authenticate(hello: WorkerHelloV3, credential: string): Promise<WorkerSessionAuthentication> | WorkerSessionAuthentication;
  audit?: AuditSink;
  pathname?: string;
};

function parseMessage(raw: RawData): unknown {
  const bytes = Buffer.isBuffer(raw) ? raw : Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw);
  if (bytes.byteLength > MAX_WORKER_SESSION_FRAME_BYTES) throw new Error("Worker WebSocket session frame is too large");
  try { return JSON.parse(bytes.toString("utf8")); }
  catch { throw new Error("Worker WebSocket session frame is not valid JSON"); }
}

export class WorkerWebSocketSessionServer {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WORKER_SESSION_FRAME_BYTES });
  private readonly pathname: string;
  private attachedServer: HttpServer | undefined;
  private readonly upgradeHandler = (req: IncomingMessage, socket: Socket, head: Buffer) => {
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname !== this.pathname) return;
    this.wss.handleUpgrade(req, socket, head, (ws) => this.wss.emit("connection", ws, req));
  };

  constructor(private readonly config: WorkerWebSocketSessionServerConfig) {
    this.pathname = config.pathname ?? "/worker-session";
    this.wss.on("connection", (ws) => this.handleConnection(ws));
  }

  attach(server: HttpServer): void {
    if (this.attachedServer) throw new Error("Worker WebSocket session server is already attached");
    this.attachedServer = server;
    server.on("upgrade", this.upgradeHandler);
  }

  async close(): Promise<void> {
    if (this.attachedServer) this.attachedServer.off("upgrade", this.upgradeHandler);
    this.attachedServer = undefined;
    for (const client of this.wss.clients) client.close(1001, "Gateway shutting down");
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
  }

  private async recordAudit(action: "worker_session.attach" | "worker_session.detach", subject: { workerId: string; environmentId: string; sessionId: string }, authentication: WorkerSessionAuthentication): Promise<void> {
    if (!this.config.audit) return;
    try {
      await this.config.audit.append(createAuditEvent({
        component: "gateway",
        category: "worker_session",
        action,
        outcome: "success",
        subject,
        detail: { authentication: authentication.kind, transport: "websocket" },
      }));
    } catch (error) {
      console.error("Audit append failed", error);
    }
  }

  private handleConnection(ws: WebSocket): void {
    let sessionId: string | undefined;
    let subject: { workerId: string; environmentId: string; sessionId: string } | undefined;
    let authentication: WorkerSessionAuthentication | undefined;
    let transport: ReverseWorkerTransport | undefined;
    let failed = false;
    let processing = Promise.resolve();

    const detach = (reason: Error) => {
      if (!sessionId) return;
      const detached = this.config.sessions.detach(sessionId, reason);
      if (detached && subject && authentication) void this.recordAudit("worker_session.detach", subject, authentication);
      sessionId = undefined;
    };
    const fail = (error: unknown, code = 1008) => {
      if (failed) return;
      failed = true;
      const reason = error instanceof Error ? error : new Error("Worker WebSocket session failed");
      detach(reason);
      try { ws.close(code, reason.message.slice(0, 120)); } catch { ws.terminate(); }
    };

    ws.on("message", (raw) => {
      processing = processing.then(async () => {
        if (failed) return;
        const parsed = parseMessage(raw);
        if (!transport) {
          const auth = workerSessionAuthenticateFrameSchema.safeParse(parsed);
          if (!auth.success) throw new Error("First Worker WebSocket frame must authenticate");
          let sessionAuthentication: WorkerSessionAuthentication;
          try { sessionAuthentication = await this.config.authenticate(auth.data.connect.hello, auth.data.credential); }
          catch { throw new Error("Worker WebSocket session authentication failed"); }

          transport = new ReverseWorkerTransport({
            send: (frame) => {
              if (failed || ws.readyState !== WebSocket.OPEN) throw new Error("Worker WebSocket session is closed");
              ws.send(JSON.stringify(frame));
            },
            close: () => {
              if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) ws.close(1000, "Session closed");
            },
          });
          const session = this.config.sessions.attach(auth.data.connect.hello, transport, sessionAuthentication);
          sessionId = session.sessionId;
          subject = { workerId: session.workerId, environmentId: session.environmentId, sessionId: session.sessionId };
          authentication = sessionAuthentication;
          await this.recordAudit("worker_session.attach", subject, sessionAuthentication);
          ws.send(JSON.stringify({ kind: "ready", sessionId } satisfies WorkerSessionFrame));
          return;
        }

        if (!parsed || typeof parsed !== "object" || ((parsed as { kind?: unknown }).kind !== "response" && (parsed as { kind?: unknown }).kind !== "error")) {
          throw new Error("Unexpected Worker-to-Gateway WebSocket frame");
        }
        transport.receive(parsed);
      }).catch((error) => fail(error));
    });
    ws.on("error", (error) => detach(error instanceof Error ? error : new Error("Worker WebSocket stream error")));
    ws.on("close", () => detach(new Error("Worker WebSocket stream closed")));
  }
}