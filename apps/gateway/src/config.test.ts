import express from "express";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { loadGatewayConfig, loadGatewayConfigFile } from "./config.js";
import { listenGateway } from "./listen.js";

const base = {
  PUBLIC_BASE_URL: "https://queqiao.example",
  OAUTH_APPROVAL_SECRET: "approval-secret-long-enough",
  JWT_SIGNING_SECRET: "signing-secret-with-at-least-thirty-two-bytes",
  QUEQIAO_STATE_DIR: "/tmp/queqiao-gateway-test",
};

describe("Gateway security configuration", () => {
  it("requires a distinct stable private owner key for Preview, independent of JWT rotation", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "queqiao-preview-key-"));
    const file = (name: string) => path.join(root, name);
    const configFile = file("config.yaml");
    const signing = file("jwt.secret");
    const approval = file("approval.secret");
    const ownerKey = file("task-owner.secret");
    const key = "separate-stable-task-owner-hmac-secret-at-least-32";
    try {
      writeFileSync(signing, "initial-jwt-key-at-least-thirty-two-bytes");
      writeFileSync(approval, "approval-only");
      writeFileSync(ownerKey, key);
      writeFileSync(configFile, [
        "version: 1", "workspaces: []", "gateway:",
        "  publicBaseUrl: https://gateway.example.test/",
        "  listen:",
        "    host: 127.0.0.1",
        "    port: 7575",
        "  stateDirectory: " + file("state").replaceAll("\\", "/"),
        "  approvalSecretFile: " + approval.replaceAll("\\", "/"),
        "  jwtSigningSecretFile: " + signing.replaceAll("\\", "/"),
        "  runtimeProviders:",
        "    githubActions:",
        "      owner: example",
        "      repo: runtime-host",
        "      workflowId: runtime.yml",
        "      auth: gh-cli",
        "      shortTasksPreview:",
        "        enabled: true",
        "        sourceRevision: " + "a".repeat(40),
        "        ownerKeyFile: " + ownerKey.replaceAll("\\", "/"),
      ].join("\n"));
      const before = loadGatewayConfigFile(configFile);
      expect(before.githubActionsRuntime?.shortTasksPreview?.ownerKey).toBe(key);
      expect(JSON.stringify(before)).not.toContain("ownerKeyFile");
      writeFileSync(signing, "rotated-different-jwt-signing-key-long-enough");
      const after = loadGatewayConfigFile(configFile);
      expect(after.githubActionsRuntime?.shortTasksPreview?.ownerKey).toBe(key);
      expect(Buffer.from(after.jwtSecret).toString()).not.toBe(Buffer.from(before.jwtSecret).toString());
      writeFileSync(ownerKey, "too-short");
      expect(() => loadGatewayConfigFile(configFile)).toThrow(/owner.*32 bytes/i);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
  it("does not accept static Worker endpoint settings as Gateway routing state", () => {
    const config = loadGatewayConfig(base);
    expect(config.host).toBe("127.0.0.1");
    expect(config).not.toHaveProperty("workers");
  });

  it("binds the verified Gateway runtime to IPv4 loopback", async () => {
    const server = listenGateway(express(), { host: "127.0.0.1", port: 0 });
    try {
      await new Promise<void>((resolve) => server.once("listening", () => resolve()));
      const address = server.address();
      expect(address && typeof address === "object" ? address.address : address).toBe("127.0.0.1");
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("rejects short Gateway JWT secrets", () => {
    expect(() => loadGatewayConfig({ ...base, JWT_SIGNING_SECRET: "short" })).toThrow(/32 bytes/);
  });

  it("keeps a path-prefixed public base URL as a directory base", () => {
    const config = loadGatewayConfig({ ...base, PUBLIC_BASE_URL: "https://queqiao.example/shadow-r5" });
    expect(config.publicBaseUrl.href).toBe("https://queqiao.example/shadow-r5/");
    expect(config.resourceUrl).toBe("https://queqiao.example/shadow-r5/mcp");
  });
});