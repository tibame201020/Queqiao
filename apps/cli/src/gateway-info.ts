import path from "node:path";
import { readFile } from "node:fs/promises";
import { readRuntimeConfig } from "@queqiao/config";
import type { RuntimeLayout } from "@queqiao/platform-paths";
import { copyTextToClipboard, type ClipboardWriter } from "./enrollment-cli.js";
import { runtimeStatus } from "./service-lifecycle.js";

function sanitizeUrl(value: string): string {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.href;
}

function resolveSecretPath(configFile: string, value: string): string {
  return path.isAbsolute(value) ? value : path.resolve(path.dirname(configFile), value);
}

async function readApprovalSecret(configFile: string, approvalSecretFile: string): Promise<string> {
  const value = (await readFile(resolveSecretPath(configFile, approvalSecretFile), "utf8")).trim();
  if (!value) throw new Error("Gateway approval secret is unavailable; run Gateway setup again");
  return value;
}

export type GatewayInfoResult = {
  schemaVersion: "1.0";
  gateway: string;
  mcpUrl: string;
  publicBaseUrl: string;
  authentication: "OAuth 2.0 Authorization Code + PKCE";
  approvalSecretAvailable: boolean;
  approvalSecret?: string;
  copied?: "mcp-url" | "approval-secret";
  running?: boolean;
  managed?: boolean;
  servicePort?: number;
  managementPort?: number;
  allowedRedirectOrigins?: string[];
};

export async function getGatewayInfo(
  configFile: string,
  layout: RuntimeLayout,
  gatewayName: string,
  args: readonly string[],
  clipboardWriter?: ClipboardWriter,
): Promise<GatewayInfoResult> {
  const detail = args.includes("--detail");
  const copyUrl = args.includes("--copy-url");
  const copySecret = args.includes("--copy-secret");
  if (copyUrl && copySecret) throw new Error("Use only one of --copy-url or --copy-secret at a time");

  const config = await readRuntimeConfig(configFile);
  if (!config.gateway) throw new Error("Gateway is not configured");
  const publicBaseUrl = sanitizeUrl(config.gateway.publicBaseUrl);
  const mcpUrl = sanitizeUrl(new URL("mcp", publicBaseUrl).href);
  let approvalSecret: string | undefined;
  let approvalSecretAvailable = false;
  try {
    approvalSecret = await readApprovalSecret(configFile, config.gateway.approvalSecretFile);
    approvalSecretAvailable = true;
  } catch {
    approvalSecretAvailable = false;
  }

  if (copyUrl) {
    await copyTextToClipboard(mcpUrl, clipboardWriter);
    return {
      schemaVersion: "1.0",
      gateway: gatewayName,
      mcpUrl,
      publicBaseUrl,
      authentication: "OAuth 2.0 Authorization Code + PKCE",
      approvalSecretAvailable,
      copied: "mcp-url",
    };
  }
  if (copySecret) {
    if (!approvalSecret) throw new Error("Gateway approval secret is unavailable; run Gateway setup again");
    await copyTextToClipboard(approvalSecret, clipboardWriter);
    return {
      schemaVersion: "1.0",
      gateway: gatewayName,
      mcpUrl,
      publicBaseUrl,
      authentication: "OAuth 2.0 Authorization Code + PKCE",
      approvalSecretAvailable: true,
      copied: "approval-secret",
    };
  }

  const result: GatewayInfoResult = {
    schemaVersion: "1.0",
    gateway: gatewayName,
    mcpUrl,
    publicBaseUrl,
    authentication: "OAuth 2.0 Authorization Code + PKCE",
    approvalSecretAvailable,
    ...(detail && approvalSecret ? { approvalSecret } : {}),
  };
  if (detail) {
    const status = await runtimeStatus(configFile, layout, "gateway", gatewayName);
    result.running = status.active;
    result.managed = status.managed;
    result.servicePort = config.gateway.listen.port;
    result.managementPort = config.gateway.managementListen.port;
    result.allowedRedirectOrigins = [...config.gateway.allowedRedirectOrigins];
  }
  return result;
}

export const gatewayInfoInternals = { sanitizeUrl, resolveSecretPath, readApprovalSecret };
