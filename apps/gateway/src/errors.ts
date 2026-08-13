export type QueqiaoErrorLayer = "gateway" | "worker";

export type QueqiaoErrorEnvelope = {
  code: string;
  message: string;
  layer: QueqiaoErrorLayer;
  retryable: boolean;
};

export class QueqiaoError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly layer: QueqiaoErrorLayer = "gateway",
    readonly retryable = false,
  ) {
    super(message);
    this.name = "QueqiaoError";
  }
}

export class WorkerHttpError extends QueqiaoError {
  constructor(readonly status: number, code: string, message: string) {
    super(code, message, "worker", workerErrorIsRetryable(code, status));
    this.name = "WorkerHttpError";
  }
}

function workerErrorIsRetryable(code: string, status: number): boolean {
  return code === "process_capacity" || status === 429 || status >= 500;
}

export function toQueqiaoErrorEnvelope(error: unknown): QueqiaoErrorEnvelope {
  if (error instanceof QueqiaoError) {
    return { code: error.code, message: error.message, layer: error.layer, retryable: error.retryable };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : "Unknown error",
    layer: "gateway",
    retryable: false,
  };
}
