import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { serializeRuntimeConfig } from "@queqiao/config";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { getGatewayInfo } from "./gateway-info.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "queqiao-gateway-info-"));
  const configDir = path.join(root, "config");
  const dataDir = path.join(root, "data");
  const stateDir = path.join(root, "state");
  const runtimeDir = path.join(root, "runtime");
  const secretsDir = path.join(dataDir, "secrets");
  const configFile = path.join(configDir, "config.yaml");
  const approvalSecretFile = path.join(secretsDir, "oauth-approval.secret");
  await Promise.all([configDir, dataDir, stateDir, runtimeDir, secretsDir].map((directory) => mkdir(directory, { recursive: true })));
  await writeFile(approvalSecretFile, "owner-approval-secret\n", "utf8");
  await writeFile(configFile, serializeRuntimeConfig({
    version: 1,
    gateway: {
      publicBaseUrl: "https://gateway.example/stable/",
      listen: { host: "127.0.0.1", port: 8075 },
      managementListen: { host: "127.0.0.1", port: 8074 },
      workerSessionListen: { host: "0.0.0.0", port: 8073 },
      workerSessionAdvertiseHost: "gateway.local",
      workerSessionTls: { certFile: path.join(secretsDir, "worker-session.crt"), keyFile: path.join(secretsDir, "worker-session.key") },
      trustProxyHops: 1,
      stateDirectory: path.join(dataDir, "gateway"),
      approvalSecretFile,
      jwtSigningSecretFile: path.join(secretsDir, "jwt.secret"),
      allowedRedirectOrigins: ["https://chatgpt.com"],
    },
    workspaces: [],
    extensions: [],
  }), "utf8");
  const layout: RuntimeLayout = {
    configDir,
    dataDir,
    stateDir,
    logDir: path.join(stateDir, "logs"),
    runtimeDir,
    secretsDir,
    configFile,
    gatewayStateDir: path.join(dataDir, "gateway"),
  };
  return { configFile, layout };
}

describe("gateway info", () => {
  it("returns the stable MCP URL without revealing the approval secret by default", async () => {
    const { configFile, layout } = await fixture();
    const result = await getGatewayInfo(configFile, layout, "stable", []);
    expect(result).toMatchObject({
      gateway: "stable",
      mcpUrl: "https://gateway.example/stable/mcp",
      publicBaseUrl: "https://gateway.example/stable/",
      authentication: "OAuth 2.0 Authorization Code + PKCE",
      approvalSecretAvailable: true,
    });
    expect(result).not.toHaveProperty("approvalSecret");
  });

  it("reveals the approval secret only with --detail", async () => {
    const { configFile, layout } = await fixture();
    const result = await getGatewayInfo(configFile, layout, "stable", ["--detail"]);
    expect(result.approvalSecret).toBe("owner-approval-secret");
    expect(result.servicePort).toBe(8075);
    expect(result.managementPort).toBe(8074);
    expect(result.workerSessionMode).toBe("remote");
    expect(result.workerSessionTarget).toBe("gateway.local:8073");
    expect(result.allowedRedirectOrigins).toEqual(["https://chatgpt.com"]);
  });

  it("copies either the MCP URL or secret without returning the secret", async () => {
    const { configFile, layout } = await fixture();
    const copied: string[] = [];
    const writer = async (value: string) => { copied.push(value); };
    const url = await getGatewayInfo(configFile, layout, "stable", ["--copy-url"], writer);
    const secret = await getGatewayInfo(configFile, layout, "stable", ["--copy-secret"], writer);
    expect(copied).toEqual(["https://gateway.example/stable/mcp", "owner-approval-secret"]);
    expect(url.copied).toBe("mcp-url");
    expect(secret.copied).toBe("approval-secret");
    expect(secret).not.toHaveProperty("approvalSecret");
  });

  it("rejects ambiguous clipboard options", async () => {
    const { configFile, layout } = await fixture();
    await expect(getGatewayInfo(configFile, layout, "stable", ["--copy-url", "--copy-secret"])).rejects.toThrow(/only one/);
  });
});
