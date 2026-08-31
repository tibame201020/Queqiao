import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createWorkerApp } from "./app.js";

let temporary: string | undefined;
afterEach(async () => { if (temporary) await rm(temporary, { recursive: true, force: true }); temporary = undefined; });

describe("Worker local reverse-session enrollment control", () => {
  it("requires the current Worker credential and activates the shared runtime session", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-grpc-control-"));
    const credential = { value: "a".repeat(48) };
    const activate = vi.fn(async () => undefined);
    const app = await createWorkerApp({
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
      workerCredential: { current: async () => credential.value },
      reverseSessionControl: { activate },
    });

    const caCertificate = `-----BEGIN CERTIFICATE-----\n${"A".repeat(80)}\n-----END CERTIFICATE-----`;
    await request(app).post("/enrollment/reverse-session/connect").send({ target: "127.0.0.1:7573", caCertificate }).expect(401);
    await request(app).post("/enrollment/reverse-session/connect").set("x-queqiao-worker-token", credential.value).send({ target: "127.0.0.1:7573", caCertificate }).expect(204);
    expect(activate).toHaveBeenCalledWith({ target: "127.0.0.1:7573", credential: credential.value, caCertificate });
  });

  it("does not acknowledge activation failure", async () => {
    temporary = await mkdtemp(path.join(os.tmpdir(), "queqiao-grpc-control-"));
    const credential = "b".repeat(48);
    const app = await createWorkerApp({
      workerId: "11111111-1111-4111-8111-111111111111",
      environmentId: "linux",
      workspaces: [{ id: "one", displayName: "One", root: temporary }],
      workerToken: credential,
      reverseSessionControl: { activate: async () => { throw new Error("session connect failed"); } },
    });

    const caCertificate = `-----BEGIN CERTIFICATE-----\n${"B".repeat(80)}\n-----END CERTIFICATE-----`;
    const response = await request(app).post("/enrollment/reverse-session/connect").set("x-queqiao-worker-token", credential).send({ target: "127.0.0.1:7573", caCertificate }).expect(502);
    expect(response.body).toMatchObject({ error: "worker_session_connect_failed" });
  });
});
