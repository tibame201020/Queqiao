import type { ExtensionRuntimePolicy } from "@queqiao/config";
import { MAX_PROCESS_TIMEOUT_MS, type ManagedStdioSession, type ProcessRunner } from "@queqiao/process-runtime";
import type { WorkspaceEntry } from "./workspace-catalog.js";
import { WorkerToolError } from "./tool-errors.js";

const MAX_HTTP_REQUEST_BYTES = 1024 * 1024;
const MAX_HTTP_RESPONSE_BYTES = 1024 * 1024;
const MAX_HTTP_HEADERS = 64;
const MAX_HTTP_HEADER_VALUE_BYTES = 8192;
const MAX_HTTP_RESPONSE_HEADER_BYTES = 64 * 1024;

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

export class WorkerExtensionRuntimeServices {
  readonly stdio: { open(input: ExtensionStdioRequest): Promise<ManagedStdioSession> };
  readonly http: { request(input: ExtensionHttpRequest): Promise<ExtensionHttpResponse> };

  constructor(private readonly input: {
    workspace: WorkspaceEntry;
    processes: StdioProcessRuntime;
    policy: ExtensionRuntimePolicy;
    signal?: AbortSignal;
  }) {
    this.stdio = { open: (request) => this.openStdio(request) };
    this.http = { request: (request) => this.requestHttp(request) };
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
    if (request.url.length > 4096) throw new WorkerToolError(400, "extension_http_invalid_url", "Extension HTTP URL is too long");
    let url: URL;
    try { url = new URL(request.url); }
    catch { throw new WorkerToolError(400, "extension_http_invalid_url", "Extension HTTP URL is invalid"); }
    if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
      throw new WorkerToolError(400, "extension_http_invalid_url", "Extension HTTP URL must use http or https without embedded credentials");
    }
    if (!this.input.policy.outboundHttp.allowOrigins.includes(url.origin)) {
      throw new WorkerToolError(403, "extension_network_denied", `Extension HTTP origin is not declared: ${url.origin}`);
    }

    const timeoutMs = request.timeoutMs ?? 30_000;
    if (!Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > MAX_PROCESS_TIMEOUT_MS) {
      throw new WorkerToolError(400, "extension_http_invalid_timeout", `timeoutMs must be between 100 and ${MAX_PROCESS_TIMEOUT_MS}`);
    }
    const body = request.body ?? undefined;
    if (body !== undefined && Buffer.byteLength(body, "utf8") > MAX_HTTP_REQUEST_BYTES) {
      throw new WorkerToolError(413, "extension_http_request_too_large", `Extension HTTP request exceeds ${MAX_HTTP_REQUEST_BYTES} bytes`);
    }
    const headers = validateHeaders(request.headers ?? {});
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
      const response = await fetch(url, {
        method: request.method,
        headers,
        ...(body !== undefined ? { body } : {}),
        redirect: "manual",
        credentials: "omit",
        signal: controller.signal,
      });
      if (response.status >= 300 && response.status < 400) {
        throw new WorkerToolError(502, "extension_http_redirect_denied", "Extension HTTP redirects are not followed");
      }
      const responseHeaders = Object.fromEntries(response.headers.entries());
      if (Buffer.byteLength(JSON.stringify(responseHeaders), "utf8") > MAX_HTTP_RESPONSE_HEADER_BYTES) {
        throw new WorkerToolError(502, "extension_http_headers_too_large", "Extension HTTP response headers exceed the bounded limit");
      }
      const responseBody = await readBoundedBody(response, controller);
      return { status: response.status, headers: responseHeaders, body: responseBody };
    } catch (error) {
      if (error instanceof WorkerToolError) throw error;
      if (controller.signal.aborted) {
        const reason = controller.signal.reason;
        if (reason instanceof Error) throw reason;
        throw new Error(timedOut ? "Extension HTTP request timed out" : "Extension HTTP request aborted");
      }
      throw new WorkerToolError(502, "extension_http_failed", error instanceof Error ? error.message : "Extension HTTP request failed");
    } finally {
      clearTimeout(timeout);
      this.input.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function validateHeaders(headers: Readonly<Record<string, string>>): Record<string, string> {
  const entries = Object.entries(headers);
  if (entries.length > MAX_HTTP_HEADERS) throw new WorkerToolError(400, "extension_http_headers_too_large", `Extension HTTP requests allow at most ${MAX_HTTP_HEADERS} headers`);
  const result: Record<string, string> = {};
  for (const [name, value] of entries) {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name)) throw new WorkerToolError(400, "extension_http_invalid_header", `Invalid HTTP header name: ${name}`);
    if (value.includes("\r") || value.includes("\n") || Buffer.byteLength(value, "utf8") > MAX_HTTP_HEADER_VALUE_BYTES) {
      throw new WorkerToolError(400, "extension_http_invalid_header", `Invalid or oversized HTTP header value: ${name}`);
    }
    const lower = name.toLowerCase();
    if (["host", "content-length", "connection", "transfer-encoding"].includes(lower)) {
      throw new WorkerToolError(400, "extension_http_forbidden_header", `Worker owns HTTP transport header: ${name}`);
    }
    result[name] = value;
  }
  return result;
}

async function readBoundedBody(response: Response, controller: AbortController): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_HTTP_RESPONSE_BYTES) {
        controller.abort(new Error("Extension HTTP response body exceeded bounded limit"));
        throw new WorkerToolError(502, "extension_http_response_too_large", `Extension HTTP response exceeds ${MAX_HTTP_RESPONSE_BYTES} bytes`);
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
