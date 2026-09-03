import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serializeRuntimeConfig } from "@queqiao/config";
import { instanceSelectorInternals, listRoleInstances, resolveRoleInstance } from "./instance-selector.js";

function envFor(root: string): NodeJS.ProcessEnv {
  return { HOME: root, LOCALAPPDATA: root, XDG_CONFIG_HOME: path.join(root, "config"), XDG_DATA_HOME: path.join(root, "data"), XDG_STATE_HOME: path.join(root, "state"), XDG_RUNTIME_DIR: path.join(root, "runtime") };
}

async function gateway(root: string, name: string, publicBaseUrl = "https://example.test/") {
  const directory = process.platform === "win32"
    ? path.join(root, "Queqiao", "gateways", name, "config")
    : path.join(root, "config", "queqiao", "gateways", name);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "config.yaml"), serializeRuntimeConfig({ version: 1, gateway: { publicBaseUrl, listen: { host: "127.0.0.1", port: 7575 }, managementListen: { host: "127.0.0.1", port: 7574 }, trustProxyHops: 1, stateDirectory: "state", approvalSecretFile: "approval", jwtSigningSecretFile: "jwt" }, workspaces: [], extensions: [] }));
}

describe("instance selector", () => {
  it("lists configured instances in stable order and sanitizes URLs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-selector-"));
    await gateway(root, "zeta");
    await gateway(root, "alpha", "https://user:pass@example.test/path?token=secret#fragment");
    const result = await listRoleInstances("gateway", { env: envFor(root), platform: process.platform });
    expect(result.map(({ name }) => name)).toEqual(["alpha", "zeta"]);
    expect(result[0]?.publicUrl).toBe("https://example.test/path");
  });

  it("reports remote Gateway and durable Worker session transport in inventory", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-selector-transport-"));
    const env = envFor(root);
    const gatewayDir = process.platform === "win32"
      ? path.join(root, "Queqiao", "gateways", "remote", "config")
      : path.join(root, "config", "queqiao", "gateways", "remote");
    await mkdir(gatewayDir, { recursive: true });
    await writeFile(path.join(gatewayDir, "config.yaml"), serializeRuntimeConfig({
      version: 1,
      gateway: {
        publicBaseUrl: "https://example.test/remote/",
        listen: { host: "127.0.0.1", port: 8075 },
        managementListen: { host: "127.0.0.1", port: 8074 },
        workerSessionListen: { host: "0.0.0.0", port: 8073 },
        workerSessionAdvertiseHost: "gateway.local",
        workerSessionTls: { certFile: "worker-session.crt", keyFile: "worker-session.key" },
        trustProxyHops: 1,
        stateDirectory: "state",
        approvalSecretFile: "approval",
        jwtSigningSecretFile: "jwt",
      },
      workspaces: [], extensions: [],
    }));

    const workerDir = process.platform === "win32"
      ? path.join(root, "Queqiao", "workers", "remote-worker", "config")
      : path.join(root, "config", "queqiao", "workers", "remote-worker");
    await mkdir(workerDir, { recursive: true });
    await writeFile(path.join(workerDir, "config.yaml"), serializeRuntimeConfig({
      version: 1,
      worker: {
        workerId: "11111111-1111-4111-8111-111111111111",
        environmentId: "remote-worker",
        listen: { host: "127.0.0.1", port: 8076 },
        tokenFile: "worker.secret",
        reverseSession: { target: "gateway.local:8073", caCertificateFile: "gateway.crt" },
      },
      workspaces: [{ id: "project", displayName: "Project", root, profile: "read-only" }],
      extensions: [],
    }));

    expect(await listRoleInstances("gateway", { env, platform: process.platform })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "remote", workerSessionMode: "remote", workerSessionTarget: "gateway.local:8073" }),
    ]));
    expect(await listRoleInstances("worker", { env, platform: process.platform })).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: "remote-worker", reverseSessionTarget: "gateway.local:8073" }),
    ]));
  });

  it("selects the only instance in a TTY and requires an explicit selector otherwise", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-selector-one-"));
    await gateway(root, "main");
    const dependencies = { env: envFor(root), platform: process.platform };
    await expect(resolveRoleInstance("gateway", [], { ...dependencies, interactive: true })).resolves.toBe("main");
    await expect(resolveRoleInstance("gateway", [], { ...dependencies, interactive: false })).rejects.toThrow(/--gateway is required/);
  });

  it("uses the entity name as the multi-instance prompt without a redundant Select verb", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-selector-many-"));
    await gateway(root, "stable");
    await gateway(root, "shadow");
    let message = "";
    const selected = await resolveRoleInstance("gateway", [], {
      env: envFor(root),
      platform: process.platform,
      interactive: true,
      choose: async (prompt, options) => {
        message = prompt;
        return options.find((option) => option.value === "stable")!.value;
      },
    });
    expect(selected).toBe("stable");
    expect(message).toBe("Gateway");
  });

  it("rejects unknown explicit instances", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-selector-unknown-"));
    await expect(resolveRoleInstance("worker", ["--worker", "missing"], { env: envFor(root), platform: process.platform, interactive: false })).rejects.toThrow(/Unknown Worker/);
  });

  it("sanitizes URL credentials, query, and fragment", () => {
    expect(instanceSelectorInternals.safeUrl("https://u:p@example.test/a?q=secret#x")).toBe("https://example.test/a");
  });

  it("preserves explicit QUEQIAO layout as one explicit default target", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-selector-explicit-"));
    const configDirectory = path.join(root, "config");
    await mkdir(configDirectory, { recursive: true });
    await writeFile(path.join(configDirectory, "config.yaml"), serializeRuntimeConfig({ version: 1, gateway: { publicBaseUrl: "https://example.test/", listen: { host: "127.0.0.1", port: 7575 }, managementListen: { host: "127.0.0.1", port: 7574 }, trustProxyHops: 1, stateDirectory: "state", approvalSecretFile: "approval", jwtSigningSecretFile: "jwt" }, workspaces: [], extensions: [] }));
    const env = { ...envFor(root), QUEQIAO_CONFIG_DIR: configDirectory, QUEQIAO_DATA_DIR: path.join(root, "data"), QUEQIAO_STATE_HOME: path.join(root, "state"), QUEQIAO_RUNTIME_DIR: path.join(root, "runtime") };
    await expect(resolveRoleInstance("gateway", ["--gateway", "default"], { env, platform: process.platform, interactive: false })).resolves.toBe("default");
    expect(await listRoleInstances("gateway", { env, platform: process.platform })).toHaveLength(1);
  });
});
