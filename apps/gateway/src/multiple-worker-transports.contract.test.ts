import { describe, expect, it } from "vitest";
import { workerMembershipRegistrySchema } from "./worker-membership-store.js";

const HTTP = { type: "http", endpoint: "http://127.0.0.1:7576/" } as const;
const GRPC = { type: "grpc", mode: "reverse" } as const;
const BASE = {
  workerId: "11111111-1111-4111-8111-111111111111",
  environmentId: "windows",
  credentialRefs: [{ kind: "secret-file", path: "secrets/worker.secret" }],
} as const;

describe("multiple Worker transport contract", () => {
  it("accepts multiple enabled transports for one Worker membership", () => {
    const parsed: any = workerMembershipRegistrySchema.parse({
      version: 1,
      workers: [{ ...BASE, transports: [HTTP, GRPC] }],
    });

    expect(parsed.workers[0].transports).toEqual([HTTP, GRPC]);
    expect(parsed.workers[0]).not.toHaveProperty("transport");
  });

  it("normalizes a legacy single HTTP transport to an HTTP-only transport set", () => {
    const parsed: any = workerMembershipRegistrySchema.parse({
      version: 1,
      workers: [{ ...BASE, transport: HTTP }],
    });

    expect(parsed.workers[0].transports).toEqual([HTTP]);
  });

  it("does not silently add gRPC while normalizing legacy HTTP membership", () => {
    const parsed: any = workerMembershipRegistrySchema.parse({
      version: 1,
      workers: [{ ...BASE, transport: HTTP }],
    });

    expect(parsed.workers[0].transports.map((entry: { type: string }) => entry.type)).toEqual(["http"]);
  });
});
