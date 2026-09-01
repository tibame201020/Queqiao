import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { runtimeConfigSchema } from "@queqiao/config";
import { resolveNamedRoleConfigRoot, resolveRuntimeLayoutForNamedRole, type RuntimeLayout } from "@queqiao/platform-paths";
import { doctorGateway, doctorPaths, doctorQueqiao } from "./doctor.js";

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

const workerConfig = runtimeConfigSchema.parse({
  version: 1,
  worker: {
    workerId: "11111111-1111-4111-8111-111111111111",
    environmentId: "windows",
    listen: { host: "127.0.0.1", port: 7576 },
    tokenFile: "worker.secret",
  },
  workspaces: [{ id: "codes", displayName: "Codes", root: "C:/codes", profile: "coding" }],
});

function layout(configFile: string): RuntimeLayout {
  return {
    configDir: `${configFile}.config`,
    dataDir: `${configFile}.data`,
    stateDir: `${configFile}.state`,
    logDir: `${configFile}.logs`,
    runtimeDir: `${configFile}.runtime`,
    secretsDir: `${configFile}.secrets`,
    configFile,
    gatewayStateDir: `${configFile}.gateway`,
  };
}

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

describe("doctorQueqiao", () => {
  it("diagnoses named Gateways and Workers instead of the legacy default runtime", async () => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ ok: true, environments: [{ environmentId: "windows", reachable: true }] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
    const result = await doctorQueqiao(layout("hub.yaml"), {
      fetchImpl,
      roleNames: async (role) => role === "gateway" ? ["stable"] : ["windows"],
      resolveNamedLayout: ((role: "gateway" | "worker", name: string) => layout(`${role}-${name}.yaml`)) as never,
      readConfig: (async (file: string) => file.startsWith("gateway-") ? config : workerConfig) as never,
      status: async (configFile, _layout, role, name) => ({
        name,
        role,
        active: true,
        managed: true,
        pid: role === "gateway" ? 100 : 200,
        health: { reachable: true, healthy: true, identityMatches: true, status: 200 },
      }),
      extensionDoctor: async () => ({ ok: true, issues: [] }),
    });

    expect(result.ok).toBe(true);
    expect(result.gateways).toMatchObject([{ name: "stable", role: "gateway", ok: true, configFile: "gateway-stable.yaml" }]);
    expect(result.workers).toMatchObject([{ name: "windows", role: "worker", ok: true, configFile: "worker-windows.yaml" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ignores stale named-role directories that do not contain a runtime config", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-doctor-stale-"));
    const env: NodeJS.ProcessEnv = process.platform === "win32"
      ? { LOCALAPPDATA: root, USERPROFILE: root }
      : { HOME: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
    const gatewayLayout = resolveRuntimeLayoutForNamedRole("gateway", "stable", env, process.platform);
    const workerLayout = resolveRuntimeLayoutForNamedRole("worker", "wsl", env, process.platform);
    await mkdir(path.dirname(gatewayLayout.configFile), { recursive: true });
    await mkdir(path.dirname(workerLayout.configFile), { recursive: true });
    await writeFile(gatewayLayout.configFile, "configured", "utf8");
    await writeFile(workerLayout.configFile, "configured", "utf8");
    await mkdir(path.join(resolveNamedRoleConfigRoot("gateway", env, process.platform), "stale-gateway"), { recursive: true });
    await mkdir(path.join(resolveNamedRoleConfigRoot("worker", env, process.platform), "stale-worker"), { recursive: true });

    const result = await doctorQueqiao(layout("hub.yaml"), {
      env,
      platform: process.platform,
      readConfig: (async (file: string) => file === gatewayLayout.configFile ? config : workerConfig) as never,
      status: async (_configFile, _layout, role, name) => ({ name, role, active: true, managed: true, pid: role === "gateway" ? 100 : 200, health: { reachable: true, healthy: true, identityMatches: true, status: 200 } }),
      fetchImpl: vi.fn(async () => new Response(JSON.stringify({ ok: true, environments: [{ environmentId: "linux", reachable: true }] }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch,
      extensionDoctor: async () => ({ ok: true, issues: [] }),
    });

    expect(result.ok).toBe(true);
    expect(result.gateways.map((entry) => entry.name)).toEqual(["stable"]);
    expect(result.workers.map((entry) => entry.name)).toEqual(["wsl"]);
  });
  it("fails the whole-system result when Extension Hub integrity fails", async () => {
    const result = await doctorQueqiao(layout("hub.yaml"), {
      roleNames: async () => [],
      extensionDoctor: async () => ({ ok: false, issues: ["broken"] }),
    });
    expect(result.ok).toBe(false);
    expect(result.extensions).toEqual({ ok: false, issues: ["broken"] });
  });

  it("reports only named role roots and the Extension Hub in normal mode", () => {
    expect(doctorPaths({ LOCALAPPDATA: "C:\\Users\\owner\\AppData\\Local", TEMP: "C:\\Temp" }, "win32")).toEqual({
      mode: "named-roles",
      gateways: "C:\\Users\\owner\\AppData\\Local\\Queqiao\\gateways",
      workers: "C:\\Users\\owner\\AppData\\Local\\Queqiao\\workers",
      extensionHub: "C:\\Users\\owner\\AppData\\Local\\Queqiao\\data\\extensions",
    });
  });
});
