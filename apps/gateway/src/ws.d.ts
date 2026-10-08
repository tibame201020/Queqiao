declare module "ws" {
  import { EventEmitter } from "node:events";
  import type { IncomingMessage } from "node:http";
  import type { Duplex } from "node:stream";

  export type RawData = Buffer | ArrayBuffer | Buffer[];

  export class WebSocket extends EventEmitter {
    static readonly CONNECTING: 0;
    static readonly OPEN: 1;
    static readonly CLOSING: 2;
    static readonly CLOSED: 3;
    readonly readyState: number;
    constructor(address: string | URL, options?: { maxPayload?: number });
    send(data: string | Buffer): void;
    close(code?: number, reason?: string): void;
    terminate(): void;
    on(event: "message", listener: (data: RawData) => void): this;
    on(event: "error", listener: (error: Error) => void): this;
    on(event: "close", listener: () => void): this;
    once(event: "open", listener: () => void): this;
    once(event: "error", listener: (error: Error) => void): this;
    once(event: "close", listener: () => void): this;
  }

  export class WebSocketServer extends EventEmitter {
    readonly clients: Set<WebSocket>;
    constructor(options: { noServer: true; maxPayload?: number });
    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer, callback: (websocket: WebSocket) => void): void;
    close(callback?: () => void): void;
    on(event: "connection", listener: (websocket: WebSocket, request: IncomingMessage) => void): this;
  }

  export default WebSocket;
}