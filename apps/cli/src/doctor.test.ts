import { describe, expect, it, vi } from "vitest";
import { runtimeConfigSchema } from "@queqiao/config";
import { doctorGateway } from "./doctor.js";

const config = runtimeConfigSchema.parse({
  version: 1,
  gateway: {
    publicBaseUrl: "https://queqiao.example/",
    listen: { host: "127.0.0.1", port: 7575 },
    managementListen: { host: "127.0.0.1", port: 7574 },
    stateDirectory: "state",
    approvalSecretFile: "approval.secret",
    jwtSigningSecretFile: "jwt.secret",
  },
  environments: [{ environmentId: "legacy", url: "http://127.0.0.1:7999", tokenFile: "legacy.secret" }],
});

describe("doctorGateway", () => {
  it("reads the Gateway liveness projection instead of legacy static Worker endpoints", async () => {
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toBe("http://127.0.0.1:7575/health");
      return new Response(JSON.stringify({ ok: true, environments: [{ environmentId: "windows", reachable: true, checkedAt: "2026-08-15T00:00:00.000Z" }] }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;
    await expect(doctorGateway(config, fetchImpl)).resolves.toMatchObject({
      ok: true,
      gateway: { reachable: true, status: 200 },
      environments: [{ environmentId: "windows", reachable: true }],
      workerDiagnostics: { supported: false },
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("keeps Worker-native diagnostics optional when no doctor capability is advertised", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: false, environments: [{ environmentId: "windows", reachable: false }] }), { status: 503, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await doctorGateway(config, fetchImpl);
    expect(result.ok).toBe(false);
    expect(result.workerDiagnostics).toEqual({ supported: false, reason: "No Worker-native doctor capability is advertised" });
  });
});
