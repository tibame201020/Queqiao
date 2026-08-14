import { WorkerHttpError } from "./errors.js";
import type { WorkerHttpTransportDescriptor, WorkerTransport, WorkerTransportRequest } from "./worker-transport.js";
import { QUEQIAO_WORKER_HTTP_API_PREFIX } from "@queqiao/worker-protocol";

export type HttpWorkerTransportConfig = {
  descriptor: WorkerHttpTransportDescriptor;
  token: string;
};

export class HttpWorkerTransport implements WorkerTransport {
  constructor(private readonly config: HttpWorkerTransportConfig) {}

  async execute<T>(request: WorkerTransportRequest, signal?: AbortSignal): Promise<T> {
    const timeout = AbortSignal.timeout(125_000);
    const combinedSignal = signal ? AbortSignal.any([timeout, signal]) : timeout;
    const { pathname, init } = this.toHttpRequest(request);
    const response = await fetch(new URL(pathname, this.config.descriptor.endpoint), {
      ...init,
      signal: combinedSignal,
      headers: {
        "content-type": "application/json",
        "x-queqiao-worker-token": this.config.token,
        ...init?.headers,
      },
    });
    const data = await response.json() as T & { error?: string; message?: string };
    if (!response.ok) {
      throw new WorkerHttpError(
        response.status,
        data.error || "worker_error",
        data.message || `Worker returned HTTP ${response.status}`,
      );
    }
    return data;
  }

  private toHttpRequest(request: WorkerTransportRequest): { pathname: string; init?: RequestInit } {
    switch (request.operation) {
      case "hello":
        return { pathname: `${QUEQIAO_WORKER_HTTP_API_PREFIX}/hello` };
      case "list-workspaces":
        return { pathname: `${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces` };
      case "workspace-info":
        return { pathname: `${QUEQIAO_WORKER_HTTP_API_PREFIX}/workspaces/${encodeURIComponent(request.workspaceId)}?tool=${request.tool}` };
      case "invoke-tool":
        return {
          pathname: `${QUEQIAO_WORKER_HTTP_API_PREFIX}/tools/${encodeURIComponent(request.toolName)}`,
          init: { method: "POST", body: JSON.stringify(request.input) },
        };
      case "legacy-read-file":
        return {
          pathname: `${QUEQIAO_WORKER_HTTP_API_PREFIX}/read-file`,
          init: { method: "POST", body: JSON.stringify(request.input) },
        };
    }
  }
}
