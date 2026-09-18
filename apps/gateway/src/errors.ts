export type QueqiaoErrorLayer = "gateway" | "worker";

export type QueqiaoErrorEnvelope = {
  code: string;
  message: string;
  layer: QueqiaoErrorLayer;
  retryable: boolean;
  capacityClass?: "foreground" | "background";
  active?: number;
  limit?: number;
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

export class WorkerRemoteError extends QueqiaoError {
  constructor(
    readonly status: number,
    code: string,
    message: string,
    retryable = workerErrorIsRetryable(code, status),
    readonly capacityClass?: "foreground" | "background",
    readonly active?: number,
    readonly limit?: number,
  ) {
    super(code, message, "worker", retryable);
    this.name = "WorkerRemoteError";
  }
}

export class WorkerHttpError extends WorkerRemoteError {
  constructor(
    status: number,
    code: string,
    message: string,
    capacityClass?: "foreground" | "background",
    active?: number,
    limit?: number,
  ) {
    super(status, code, message, workerErrorIsRetryable(code, status), capacityClass, active, limit);
    this.name = "WorkerHttpError";
  }
}

function workerErrorIsRetryable(code: string, status: number): boolean {
  return code === "process_capacity" || status === 429 || status >= 500;
}

export function toQueqiaoErrorEnvelope(error: unknown): QueqiaoErrorEnvelope {
  if (error instanceof QueqiaoError) {
    return {
      code: error.code,
      message: error.message,
      layer: error.layer,
      retryable: error.retryable,
      ...(error instanceof WorkerRemoteError && error.capacityClass ? { capacityClass: error.capacityClass } : {}),
      ...(error instanceof WorkerRemoteError && error.active !== undefined ? { active: error.active } : {}),
      ...(error instanceof WorkerRemoteError && error.limit !== undefined ? { limit: error.limit } : {}),
    };
  }
  return {
    code: "internal_error",
    message: error instanceof Error ? error.message : "Unknown error",
    layer: "gateway",
    retryable: false,
  };
}
