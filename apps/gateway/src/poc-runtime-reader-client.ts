import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { assertEphemeralRead } from "./poc-runtime-reader.js";

// This acceptance client is only run inside a manually approved GitHub Actions
// controller. Do not put OAuth artifacts or approval credentials into logs.
const localBase = process.env["QUEQIAO_POC_LOCAL_URL"] ?? "http://127.0.0.1:7575";
const publicBase = process.env["QUEQIAO_POC_PUBLIC_URL"];
const secretFile = process.env["QUEQIAO_POC_APPROVAL_SECRET_FILE"];
const environmentId = process.env["QUEQIAO_POC_ENVIRONMENT_ID"];
if (!publicBase || !secretFile || !environmentId) throw new Error("Incomplete POC runtime configuration");

const approvalSecret = (await readFile(secretFile, "utf8")).trim();
const resource = new URL("mcp", publicBase.endsWith("/") ? publicBase : publicBase + "/").href;
const redirect = "https://chatgpt.com/connector/oauth/callback";
const verifier = randomBytes(40).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");

async function jsonPost(route: string, data: unknown): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(route, localBase), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OAuth ${route} returned HTTP ${response.status}`);
  return await response.json() as Record<string, unknown>;
}

async function formPost(route: string, data: Record<string, string>, redirectMode: "manual" | "follow"): Promise<Response> {
  return fetch(new URL(route, localBase), {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(data),
    redirect: redirectMode,
    signal: AbortSignal.timeout(20_000),
  });
}

const registration = await jsonPost("/oauth/register", {
  client_name: "Queqiao Actions Runtime Tool Acceptance",
  redirect_uris: [redirect],
  token_endpoint_auth_method: "none",
  scope: "workspace:read",
});
const clientId = registration["client_id"];
if (typeof clientId !== "string") throw new Error("OAuth client registration lacked client_id");

const authorization = {
  client_id: clientId,
  redirect_uri: redirect,
  response_type: "code",
  code_challenge: challenge,
  code_challenge_method: "S256",
  scope: "workspace:read",
  resource,
  state: "github-actions-mcp-tool-acceptance",
};
const approved = await formPost("/oauth/authorize", {
  ...authorization,
  approval_secret: approvalSecret,
}, "manual");
if (approved.status !== 303) throw new Error(`OAuth authorization returned HTTP ${approved.status}`);
const callback = approved.headers.get("location");
const code = callback ? new URL(callback).searchParams.get("code") : null;
if (!code) throw new Error("OAuth authorization code missing");

const tokenResult = await formPost("/oauth/token", {
  grant_type: "authorization_code",
  code,
  redirect_uri: redirect,
  client_id: clientId,
  code_verifier: verifier,
  resource,
}, "manual");
if (!tokenResult.ok) throw new Error(`OAuth token returned HTTP ${tokenResult.status}`);
const tokenPayload = await tokenResult.json() as { access_token?: unknown };
if (typeof tokenPayload.access_token !== "string") throw new Error("OAuth access token missing");

const client = new Client(
  { name: "queqiao-actions-tool-poc", version: "1" },
  { supportedProtocolVersions: ["2025-11-25"], versionNegotiation: { mode: "legacy" } },
);
const transport = new StreamableHTTPClientTransport(new URL("mcp", localBase.endsWith("/") ? localBase : localBase + "/"), {
  requestInit: { headers: { Authorization: `Bearer ${tokenPayload.access_token}` } },
});

try {
  await client.connect(transport);
  const response = await client.callTool({
    name: "read_file",
    arguments: { workspaceId: "runtime", path: "poc-marker.txt", offset: 0, limit: 1 },
  }, { timeout: 30_000 });
  const checked = assertEphemeralRead(response, {
    workspaceId: "runtime",
    environmentId,
    path: "poc-marker.txt",
    marker: "QUEQIAO-GITHUB-CONNECTOR-OK",
  });
  console.log(JSON.stringify({ ok: true, tool: "read_file", workspace: "runtime", ...checked }));
} finally {
  await client.close();
}

