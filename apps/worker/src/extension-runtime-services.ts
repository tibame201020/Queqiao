import type { ExtensionRuntimePolicy } from "@queqiao/config";
import { MAX_PROCESS_TIMEOUT_MS, type ManagedStdioSession, type ProcessRunner } from "@queqiao/process-runtime";
import type { WorkspaceEntry } from "./workspace-catalog.js";
import { WorkerToolError } from "./tool-errors.js";

const MAX_HTTP_REQUEST_BYTES = 1024 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 1024 * 1024;
const MAX_HTTP_HEADERS = 64;
const MAX_HTTP_HEADER_VALUE_BYTES = 8192;
const MAX_HTTP_RESPONSE_HEADER_BYTES = 64 * 1024;
const DEFAULT_HTTP_REQUEST_TIMEOUT_MS = 30_000;
const MAX_HTTP_STREAM_LIFETIME_MS = MAX_PROCESS_TIMEOUT_MS;
const ALLOWED_HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]);

type ExtensionStdioRequest = {
  executable: string;
  args?: readonly string[];
  cwd?: string;
  timeoutMs?: number;
};

type ExtensionHttpRequest = {
  url: string;
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD";
  headers?: Readonly<Record<string, string>>;
  body?: string;
  timeoutMs?: number;
};

export type ExtensionHttpResponse = {
  status: number;
  headers: Record<string, string>;
  body: string;
};

type StdioProcessRuntime = Pick<ProcessRunner, "openStdio">;
type ExtensionFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class WorkerExtensionRuntimeServices {
  readonly stdio: { open(input: ExtensionStdioRequest): Promise<ManagedStdioSession> };
  readonly http: { request(input: ExtensionHttpRequest): Promise<ExtensionHttpResponse>; fetch: ExtensionFetch };

  constructor(private readonly input: {
    workspace: WorkspaceEntry;
    processes: StdioProcessRuntime;
    policy: ExtensionRuntimePolicy;
    signal?: AbortSignal;
  }) {
    this.stdio = { open: (request) => this.openStdio(request) };
    this.http = {
      request: (request) => this.requestHttp(request),
      fetch: (fetchInput, init) => this.fetchHttp(fetchInput, init),
    };
  }

  withSignal(signal: AbortSignal | undefined): WorkerExtensionRuntimeServices {
    return new WorkerExtensionRuntimeServices({ ...this.input, ...(signal ? { signal } : {}) });
  }

  private async openStdio(request: ExtensionStdioRequest): Promise<ManagedStdioSession> {
    const allowed = process.platform === "win32"
      ? this.input.policy.processes.allow.some((value) => value.toLowerCase() === request.executable.toLowerCase())
      : this.input.policy.processes.allow.includes(request.executable);
    if (!allowed) throw new WorkerToolError(403, "extension_process_denied", `Extension process is not declared: ${request.executable}`);
    const cwd = await this.input.workspace.reader.resolveStrictDirectory(request.cwd ?? ".");
    return this.input.processes.openStdio({
      executable: request.executable,
      args: request.args ?? [],
      cwd,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(this.input.signal ? { signal: this.input.signal } : {}),
    });
  }

  private async requestHttp(request: ExtensionHttpRequest): Promise<ExtensionHttpResponse> {
    const timeoutMs = request.timeoutMs ?? DEFAULT_HTTP_REQUEST_TIMEOUT_MS;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_PROCESS_TIMEOUT_MS) {
      throw new WorkerToolError(400, "extension_http_invalid_timeout", `timeoutMs must be between 100 and ${MAX_PROCESS_TIMEOUT_MS}`);
    }
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Extension HTTP request timed out"));
    }, timeoutMs);
    const onAbort = () => controller.abort(this.input.signal?.reason ?? new Error("Extension HTTP request aborted"));
    this.input.signal?.addEventListener("abort", onAbort, { once: true });
    if (this.input.signal?.aborted) onAbort();

    try {
      const response = await this.fetchHttp(request.url, {
        method: request.method,
        headers: request.headers,
        ...(request.body !== undefined ? { body: request.body } : {}),
        signal: controller.signal,
      });
      const body = await response.text();
      return { status: response.status, headers: Object.fromEntries(response.headers.entries()), body };
    } catch (error) {
      if (error instanceof WorkerToolError) throw error;
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof Error) throw reason;
        throw new Error(timedOut ? "Extension HTTP request timed out" : "Extension HTTP request aborted");
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      this.input.signal?.removeEventListener("abort", onAbort);
    }
  }

  private async fetchHttp(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    let request: Request;
    try { request = new Request(input, init); }
    catch { throw new WorkerToolError(400, "extension_http_invalid_request", "Extension HTTP request is invalid"); }

    const url = validateUrl(request.url, this.input.policy);
    const method = request.method.toUpperCase();
    if (!ALLOWED_HTTP_METHODS.has(method)) {
      throw new WorkerToolError(400, "extension_http_invalid_method", `Extension HTTP method is not allowed: ${method}`);
    }
    const headers = validateHeaders(request.headers);
    const body = await readBoundedRequestBody(request);
    const controller = new AbortController();
    let timedOut = false;
    let cleanedUp = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error("Extension HTTP stream exceeded bounded lifetime"));
    }, MAX_HTTP_STREAM_LIFETIME_MS);
    const onAbort = () => controller.abort(request.signal.reason ?? new Error("Extension HTTP request aborted"));
    request.signal.addEventListener("abort", onAbort, { once: true });
    if (request.signal.aborted) onAbort();
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearTimeout(timeout);
      request.signal.removeEventListener("abort", onAbort);
    };

    try {
      const response = await fetch(url, {
        method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        controller.abort(new Error("Extension HTTP redirects are not followed"));
        throw new WorkerToolError(502, "extension_http_redirect_denied", "Extension HTTP redirects are not followed");
      }
      if (Buffer.byteLength(JSON.stringify(Object.fromEntries(response.headers.entries())), "utf8") > MAX_HTTP_RESPONSE_HEADER_BYTES) {
        controller.abort(new Error("Extension HTTP response headers exceeded bounded limit"));
        throw new WorkerToolError(502, "extension_http_headers_too_large", "Extension HTTP response headers exceed the bounded limit");
      }
      if (!response.body) {
        cleanup();
        return new Response(null, { status: response.status, statusText: response.statusText, headers: response.headers });
      }
      const streamedBody = boundedResponseBody(response.body, controller, cleanup);
      return new Response(streamedBody, { status: response.status, statusText: response.statusText, headers: response.headers });
    } catch (error) {
      cleanup();
      if (error instanceof WorkerToolError) throw error;
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof Error) throw reason;
        throw new Error(timedOut ? "Extension HTTP stream exceeded bounded lifetime" : "Extension HTTP request aborted");
      }
      throw new WorkerToolError(502, "extension_http_failed", error instanceof Error ? error.message : "Extension HTTP request failed");
    }
  }
}

function validateUrl(value: string, policy: ExtensionRuntimePolicy): URL {
  if (value.length > 4096) throw new WorkerToolError(400, "extension_http_invalid_url", "Extension HTTP URL is too long");
  let url: URL;
  try { url = new URL(value); }
  catch { throw new WorkerToolError(400, "extension_http_invalid_url", "Extension HTTP URL is invalid"); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new WorkerToolError(400, "extension_http_invalid_url", "Extension HTTP URL must use http or https without embedded credentials");
  }
  if (!policy.outboundHttp.allowOrigins.includes(url.origin)) {
    throw new WorkerToolError(403, "extension_network_denied", `Extension HTTP origin is not declared: ${url.origin}`);
  }
  return url;
}

function validateHeaders(headers: Headers): Headers {
  const entries = [...headers.entries()];
  if (entries.length > MAX_HTTP_HEADERS) throw new WorkerToolError(400, "extension_http_headers_too_large", `Extension HTTP requests allow at most ${MAX_HTTP_HEADERS} headers`);
  const result = new Headers();
  for (const [name, value] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new WorkerToolError(400, "extension_http_invalid_header", `Invalid HTTP header name: ${name}`);
    if (value.includes("\r") || value.includes("\n") || Buffer.byteLength(value, "utf8") > MAX_HTTP_HEADER_VALUE_BYTES) {
      throw new WorkerToolError(400, "extension_http_invalid_header", `Invalid or oversized HTTP header value: ${name}`);
    }
    const lower = name.toLowerCase();
    if (["host", "content-length", "connection", "transfer-encoding"].includes(lower)) {
      throw new WorkerToolError(400, "extension_http_forbidden_header", `Worker owns HTTP transport header: ${name}`);
    }
    result.append(name, value);
  }
  return result;
}

async function readBoundedRequestBody(request: Request): Promise<Uint8Array | undefined> {
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTTP_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new WorkerToolError(413, "extension_http_request_too_large", `Extension HTTP request exceeds ${MAX_HTTP_REQUEST_BYTES} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function boundedResponseBody(body: ReadableStream<Uint8Array>, controller: AbortController, cleanup: () => void): ReadableStream<Uint8Array> {
  const reader = body.getReader();
  let bytes = 0;
  let settled = false;
  const settle = () => {
    if (settled) return;
    settled = true;
    cleanup();
    reader.releaseLock();
  };
  return new ReadableStream<Uint8Array>({
    start(streamController) {
      controller.signal.addEventListener("abort", () => {
        if (settled) return;
        void reader.cancel(controller.signal.reason).catch(() => undefined);
        const reason = controller.signal.reason;
        streamController.error(reason instanceof Error ? reason : new Error("Extension HTTP stream aborted"));
        settle();
      }, { once: true });
    },
    async pull(streamController) {
      if (settled) return;
      try {
        const { done, value } = await reader.read();
        if (done) {
          streamController.close();
          settle();
          return;
        }
        bytes += value.byteLength;
        if (bytes > MAX_HTTP_RESPONSE_BYTES) {
          const error = new WorkerToolError(502, "extension_http_response_too_large", `Extension HTTP response exceeds ${MAX_HTTP_RESPONSE_BYTES} bytes`);
          controller.abort(error);
          return;
        }
        streamController.enqueue(value);
      } catch (error) {
        streamController.error(error);
        settle();
      }
    },
    async cancel(reason) {
      if (settled) return;
      try { await reader.cancel(reason); }
      finally { settle(); }
    },
  });
}
