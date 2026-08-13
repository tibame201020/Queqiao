export * from "@queqiao/contracts";
export {
  QUEQIAO_WORKER_CAPABILITIES,
  QUEQIAO_WORKER_HTTP_API_PREFIX,
  QUEQIAO_WORKER_PROTOCOL_VERSION,
  workerHelloSchema,
  workerToolInvocationResponseSchema,
  type WorkerHello,
  type WorkerToolInvocationResponse,
} from "@queqiao/worker-protocol";

// Compatibility alias for code written before the Worker protocol boundary was named explicitly.
// New code must use QUEQIAO_WORKER_PROTOCOL_VERSION from @queqiao/worker-protocol.
export { QUEQIAO_WORKER_PROTOCOL_VERSION as QUEQIAO_PROTOCOL_VERSION } from "@queqiao/worker-protocol";

export * from "./v0-tools.js";
