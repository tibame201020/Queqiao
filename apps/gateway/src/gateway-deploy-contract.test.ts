import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { runtimeConfigSchema } from "@queqiao/config";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const service = (name: string) => readFileSync(path.join(root, "deploy", "systemd", name), "utf8");

describe("persistent Gateway deployment contract", () => {
  it("runs Gateway as a non-root supervised service with persistent private state", () => {
    const unit = service("queqiao-gateway.service");
    for (const clause of [
      "User=queqiao", "Group=queqiao", "Restart=on-failure", "RestartSec=5",
      "NoNewPrivileges=true", "ProtectSystem=strict", "ProtectHome=true",
      "PrivateTmp=true", "UMask=0077", "StateDirectory=queqiao",
      "Environment=QUEQIAO_CONFIG_FILE=/etc/queqiao/config.yaml",
      "ExecStart=/usr/bin/node /opt/queqiao/apps/gateway/dist/index.js",
    ]) expect(unit).toContain(clause);
    expect(unit).not.toMatch(/Environment=.*(?:TOKEN|SECRET|PASSWORD)=\S+/);
  });

  it("restricts the named HTTPS ingress to the Gateway loopback port", () => {
    const unit = service("queqiao-cloudflared.service");
    const config = service("tunnel.yml.example");
    expect(unit).toContain("User=cloudflared");
    expect(unit).toContain("Restart=always");
    expect(unit).toContain("/etc/queqiao/tunnel.yml");
    expect(config).toContain("service: http://127.0.0.1:7575");
    expect(config).toContain("service: http_status:404");
    expect(config).toContain("credentials-file: /etc/queqiao/tunnel-credentials.json");
    expect(config).not.toContain(".trycloudflare.com");
  });

  it("keeps OAuth issuer stable and all runtime secrets external to the repository", () => {
    const config = parse(service("config.yaml.example"));
    const parsed = runtimeConfigSchema.parse(config);
    expect(parsed.gateway?.publicBaseUrl).toBe("https://gateway.example.invalid/");
    expect(parsed.gateway?.listen.host).toBe("127.0.0.1");
    expect(parsed.gateway?.listen.port).toBe(7575);
    expect(parsed.gateway?.stateDirectory).toBe("/var/lib/queqiao");
    expect(parsed.gateway?.runtimeProviders.githubActions?.mcpPocEnabled).not.toBe(true);
    expect(parsed.gateway?.runtimeProviders.githubActions?.tokenFile).toContain("/etc/queqiao/");
    expect(parsed.gateway?.approvalSecretFile).toContain("/etc/queqiao/");
    expect(parsed.gateway?.jwtSigningSecretFile).toContain("/etc/queqiao/");
  });
});
