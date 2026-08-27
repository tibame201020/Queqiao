import request from "supertest";
import { describe, expect, it } from "vitest";
import { createRuntimeSupervisorApp } from "./runtime-supervisor-server.js";

describe("runtime supervisor transport", () => {
  it("requires its own secret and redacts managed PID from lifecycle projections", async () => {
    const secret = "s".repeat(43);
    const app = createRuntimeSupervisorApp({
      secret,
      resolveSupervisor: () => ({
        status: async () => ({
          apiVersion: 1 as const,
          role: "gateway" as const,
          name: "shadow",
          readiness: { state: "ready" as const },
          health: { state: "healthy" as const, reachable: true, healthy: true, identityMatches: true, probedAt: new Date(0).toISOString() },
          ownership: { state: "managed" as const, pid: 4242 },
          endpoint: { url: "http://127.0.0.1:7675/", port: 7675 },
          actions: { start: false, stop: true, restart: true, setup: false, addWorkspace: false, inspectConflict: false },
        }),
        start: async () => undefined,
        stop: async () => undefined,
        restart: async () => undefined,
      }),
    });
    await request(app).get("/v1/runtime-lifecycle/gateway/shadow").expect(401);
    const response = await request(app).get("/v1/runtime-lifecycle/gateway/shadow").set("x-queqiao-supervisor-secret", secret).expect(200);
    expect(response.body.ownership).toEqual({ state: "managed" });
    expect(response.body.ownership).not.toHaveProperty("pid");
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("rejects invalid role and runtime names before resolving local process authority", async () => {
    const secret = "s".repeat(43);
    const app = createRuntimeSupervisorApp({ secret, resolveSupervisor: () => { throw new Error("must not resolve"); } });
    await request(app).get("/v1/runtime-lifecycle/bad/shadow").set("x-queqiao-supervisor-secret", secret).expect(400);
    await request(app).get("/v1/runtime-lifecycle/gateway/..bad").set("x-queqiao-supervisor-secret", secret).expect(400);
  });
});
