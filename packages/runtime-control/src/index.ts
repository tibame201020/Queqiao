import { environmentIdSchema, workerIdSchema } from "@queqiao/contracts";
import { z } from "zod";

export const runtimeProviderIdSchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9._-]*$/);

const metadataKeySchema = z.string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9._-]+$/);

const SECRET_LIKE_METADATA_KEY = /secret|token|password|credential|authorization|cookie|api[._-]?key/i;

export const runtimeProviderMetadataSchema = z.record(metadataKeySchema, z.string().max(512))
  .superRefine((metadata, ctx) => {
    if (Object.keys(metadata).length > 32) {
      ctx.addIssue({ code: "custom", message: "Runtime provider metadata is limited to 32 entries" });
    }
    for (const key of Object.keys(metadata)) {
      if (SECRET_LIKE_METADATA_KEY.test(key)) {
        ctx.addIssue({ code: "custom", path: [key], message: "Runtime provider metadata must not contain credential-like fields" });
      }
    }
  });

export const runtimeLeaseStateSchema = z.enum([
  "requested",
  "provisioning",
  "registered",
  "ready",
  "running",
  "completed",
  "failed",
  "expired",
  "disposed",
]);

const timestampSchema = z.string().datetime({ offset: true });

export const runtimeWorkerBindingSchema = z.object({
  workerId: workerIdSchema,
  environmentId: environmentIdSchema,
});

export const runtimeLeaseTerminalSchema = z.object({
  outcome: z.enum(["completed", "failed", "expired"]),
  at: timestampSchema,
  detail: z.string().min(1).max(512).optional(),
});

export const runtimeLeaseSchema = z.object({
  version: z.literal(1),
  leaseId: z.uuid(),
  providerId: runtimeProviderIdSchema,
  state: runtimeLeaseStateSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  expiresAt: timestampSchema,
  metadata: runtimeProviderMetadataSchema.default({}),
  providerRef: z.string().min(1).max(512).optional(),
  providerMetadata: runtimeProviderMetadataSchema.optional(),
  worker: runtimeWorkerBindingSchema.optional(),
  terminal: runtimeLeaseTerminalSchema.optional(),
  disposedAt: timestampSchema.optional(),
}).superRefine((lease, ctx) => {
  if (Date.parse(lease.expiresAt) <= Date.parse(lease.createdAt)) {
    ctx.addIssue({ code: "custom", path: ["expiresAt"], message: "Runtime lease expiry must be after creation" });
  }

  if (["registered", "ready", "running"].includes(lease.state) && !lease.worker) {
    ctx.addIssue({ code: "custom", path: ["worker"], message: `Runtime lease state ${lease.state} requires a Worker binding` });
  }

  const expectedOutcome =
    lease.state === "completed" ? "completed"
      : lease.state === "failed" ? "failed"
        : lease.state === "expired" ? "expired"
          : undefined;

  if (expectedOutcome && lease.terminal?.outcome !== expectedOutcome) {
    ctx.addIssue({ code: "custom", path: ["terminal"], message: `Runtime lease state ${lease.state} requires terminal outcome ${expectedOutcome}` });
  }

  if (lease.state === "disposed") {
    if (!lease.terminal) ctx.addIssue({ code: "custom", path: ["terminal"], message: "Disposed runtime lease requires a terminal outcome" });
    if (!lease.disposedAt) ctx.addIssue({ code: "custom", path: ["disposedAt"], message: "Disposed runtime lease requires disposedAt" });
  }

  if (["requested", "provisioning", "registered", "ready", "running"].includes(lease.state)) {
    if (lease.terminal) ctx.addIssue({ code: "custom", path: ["terminal"], message: "Active runtime lease must not contain a terminal outcome" });
    if (lease.disposedAt) ctx.addIssue({ code: "custom", path: ["disposedAt"], message: "Active runtime lease must not contain disposedAt" });
  }
});

export type RuntimeProviderMetadata = z.infer<typeof runtimeProviderMetadataSchema>;
export type RuntimeLeaseState = z.infer<typeof runtimeLeaseStateSchema>;
export type RuntimeWorkerBinding = z.infer<typeof runtimeWorkerBindingSchema>;
export type RuntimeLease = z.infer<typeof runtimeLeaseSchema>;

export type CreateRuntimeLeaseInput = {
  leaseId: string;
  providerId: string;
  ttlSeconds: number;
  now: string;
  metadata?: RuntimeProviderMetadata;
};

export type RuntimeLeaseEvent =
  | { type: "begin-provisioning" }
  | { type: "ready" }
  | { type: "running" }
  | { type: "completed" }
  | { type: "failed"; detail?: string }
  | { type: "disposed" };

export type RuntimeProvisionRequest = {
  leaseId: string;
  ttlSeconds: number;
  metadata: RuntimeProviderMetadata;
};

export type RuntimeProvisionResult = {
  providerRef: string;
  metadata?: RuntimeProviderMetadata;
};

export type RuntimeDisposeRequest = {
  leaseId: string;
  providerRef: string;
  reason: "completed" | "failed" | "expired";
};

export interface RuntimeProvider {
  readonly id: string;
  provision(request: RuntimeProvisionRequest): Promise<RuntimeProvisionResult>;
  dispose(request: RuntimeDisposeRequest): Promise<void>;
}

function timestamp(value: string): string {
  return timestampSchema.parse(value);
}

function withUpdate(lease: RuntimeLease, patch: Partial<RuntimeLease>, at: string): RuntimeLease {
  return runtimeLeaseSchema.parse({ ...lease, ...patch, updatedAt: timestamp(at) });
}

function invalidTransition(lease: RuntimeLease, event: RuntimeLeaseEvent["type"]): never {
  throw new Error(`Invalid Runtime Lease transition: ${lease.state} -> ${event}`);
}

function terminalConflict(lease: RuntimeLease, requested: "completed" | "failed"): never {
  throw new Error(`Runtime Lease already has terminal outcome ${lease.terminal?.outcome ?? lease.state}; cannot apply ${requested}`);
}

export function createRuntimeLease(input: CreateRuntimeLeaseInput): RuntimeLease {
  const now = timestamp(input.now);
  const ttlSeconds = z.number().int().min(10).max(604_800).parse(input.ttlSeconds);
  const created = Date.parse(now);
  return runtimeLeaseSchema.parse({
    version: 1,
    leaseId: input.leaseId,
    providerId: input.providerId,
    state: "requested",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(created + ttlSeconds * 1000).toISOString(),
    metadata: input.metadata ?? {},
  });
}

export function recordProviderRuntime(
  input: RuntimeLease,
  result: RuntimeProvisionResult,
): RuntimeLease {
  const lease = runtimeLeaseSchema.parse(input);
  const providerRef = z.string().min(1).max(512).parse(result.providerRef);
  const providerMetadata = result.metadata ? runtimeProviderMetadataSchema.parse(result.metadata) : undefined;

  if (lease.providerRef) {
    const sameMetadata = JSON.stringify(lease.providerMetadata ?? {}) === JSON.stringify(providerMetadata ?? {});
    if (lease.providerRef === providerRef && sameMetadata) return lease;
    throw new Error("Runtime Lease already has a different provider runtime binding");
  }

  if (lease.state !== "provisioning") {
    throw new Error(`Provider runtime can only be recorded while provisioning; current state is ${lease.state}`);
  }

  return runtimeLeaseSchema.parse({
    ...lease,
    providerRef,
    ...(providerMetadata ? { providerMetadata } : {}),
  });
}

export function bindRuntimeWorker(
  input: RuntimeLease,
  binding: RuntimeWorkerBinding,
  at: string,
): RuntimeLease {
  const lease = runtimeLeaseSchema.parse(input);
  const worker = runtimeWorkerBindingSchema.parse(binding);

  if (lease.worker) {
    if (lease.worker.workerId === worker.workerId && lease.worker.environmentId === worker.environmentId) return lease;
    throw new Error(`Runtime Lease is already bound to Worker ${lease.worker.workerId}`);
  }

  if (lease.state !== "provisioning") {
    throw new Error(`Runtime Worker can only bind while provisioning; current state is ${lease.state}`);
  }

  return withUpdate(lease, { state: "registered", worker }, at);
}

export function transitionRuntimeLease(
  input: RuntimeLease,
  event: RuntimeLeaseEvent,
  at: string,
): RuntimeLease {
  const lease = runtimeLeaseSchema.parse(input);
  const eventAt = timestamp(at);

  switch (event.type) {
    case "begin-provisioning":
      if (lease.state === "provisioning") return lease;
      if (lease.state !== "requested") return invalidTransition(lease, event.type);
      return withUpdate(lease, { state: "provisioning" }, eventAt);

    case "ready":
      if (lease.state === "ready") return lease;
      if (lease.state !== "registered") return invalidTransition(lease, event.type);
      return withUpdate(lease, { state: "ready" }, eventAt);

    case "running":
      if (lease.state === "running") return lease;
      if (lease.state !== "ready") return invalidTransition(lease, event.type);
      return withUpdate(lease, { state: "running" }, eventAt);

    case "completed":
      if (lease.state === "completed") return lease;
      if (lease.state === "disposed" && lease.terminal?.outcome === "completed") return lease;
      if (["failed", "expired", "disposed"].includes(lease.state)) return terminalConflict(lease, "completed");
      if (lease.state !== "running") return invalidTransition(lease, event.type);
      return withUpdate(lease, {
        state: "completed",
        terminal: { outcome: "completed", at: eventAt },
      }, eventAt);

    case "failed":
      if (lease.state === "failed") return lease;
      if (lease.state === "disposed" && lease.terminal?.outcome === "failed") return lease;
      if (["completed", "expired", "disposed"].includes(lease.state)) return terminalConflict(lease, "failed");
      return withUpdate(lease, {
        state: "failed",
        terminal: {
          outcome: "failed",
          at: eventAt,
          ...(event.detail ? { detail: z.string().min(1).max(512).parse(event.detail) } : {}),
        },
      }, eventAt);

    case "disposed":
      if (lease.state === "disposed") return lease;
      if (!["completed", "failed", "expired"].includes(lease.state)) return invalidTransition(lease, event.type);
      return withUpdate(lease, { state: "disposed", disposedAt: eventAt }, eventAt);
  }
}

export function expireRuntimeLease(input: RuntimeLease, at: string): RuntimeLease {
  const lease = runtimeLeaseSchema.parse(input);
  const eventAt = timestamp(at);
  if (["completed", "failed", "expired", "disposed"].includes(lease.state)) return lease;
  if (Date.parse(eventAt) < Date.parse(lease.expiresAt)) return lease;
  return withUpdate(lease, {
    state: "expired",
    terminal: { outcome: "expired", at: eventAt },
  }, eventAt);
}
