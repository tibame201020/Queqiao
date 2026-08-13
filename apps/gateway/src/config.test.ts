import { describe, expect, it } from "vitest";
import { loadGatewayConfig } from "./config.js";

const base = {
  PUBLIC_BASE_URL: "https://queqiao.example",
  OAUTH_APPROVAL_SECRET: "approval-secret-long-enough",
  JWT_SIGNING_SECRET: "signing-secret-with-at-least-thirty-two-bytes",
  QUEQIAO_WORKER_TOKEN: "worker-token-with-at-least-thirty-two-bytes",
  QUEQIAO_STATE_DIR: "/tmp/queqiao-gateway-test",
};

describe("Gateway security configuration", () => {
  it("accepts only loopback HTTP Worker endpoints in the verified baseline", () => {
    expect(loadGatewayConfig({ ...base, QUEQIAO_WORKER_URL: "http://127.0.0.1:7576" }).workers[0]?.url.href).toBe("http://127.0.0.1:7576/");
    expect(() => loadGatewayConfig({ ...base, QUEQIAO_WORKER_URL: "http://attacker.example:7576" })).toThrow(/loopback/);
    expect(() => loadGatewayConfig({ ...base, QUEQIAO_WORKER_URL: "https://127.0.0.1:7576" })).toThrow(/loopback/);
    expect(() => loadGatewayConfig({ ...base, QUEQIAO_WORKER_URL: "http://user:pass@127.0.0.1:7576" })).toThrow(/credentials/);
  });

  it("rejects short Worker and JWT secrets", () => {
    expect(() => loadGatewayConfig({ ...base, QUEQIAO_WORKER_TOKEN: "short" })).toThrow(/32 bytes/);
    expect(() => loadGatewayConfig({ ...base, JWT_SIGNING_SECRET: "short" })).toThrow(/32 bytes/);
  });

  it("keeps a path-prefixed public base URL as a directory base", () => {
    const config = loadGatewayConfig({ ...base, PUBLIC_BASE_URL: "https://queqiao.example/shadow-r5" });
    expect(config.publicBaseUrl.href).toBe("https://queqiao.example/shadow-r5/");
    expect(config.resourceUrl).toBe("https://queqiao.example/shadow-r5/mcp");
  });
});
