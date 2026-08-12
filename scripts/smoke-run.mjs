import { createHash, randomBytes } from "node:crypto";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadRuntimeEnvironment, readRuntimeSecret } from "./runtime-env.mjs";

await loadRuntimeEnvironment();
const base = new URL(process.env.PUBLIC_BASE_URL);
const approvalSecret = await readRuntimeSecret("OAUTH_APPROVAL_SECRET");
const resource = new URL("mcp", base).href;
const redirectUri = "http://127.0.0.1/callback";
const verifier = randomBytes(40).toString("base64url");
const challenge = createHash("sha256").update(verifier).digest("base64url");
async function json(url, init) { const response = await fetch(url, init); const body = await response.json(); if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(body)}`); return body; }
const registration = await json(new URL("oauth/register", base), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ client_name: "Queqiao run smoke", redirect_uris: [redirectUri], token_endpoint_auth_method: "none", scope: "queqiao:access" }) });
const authorization = new URL("oauth/authorize", base);
for (const [key, value] of Object.entries({ client_id: registration.client_id, redirect_uri: redirectUri, response_type: "code", code_challenge: challenge, code_challenge_method: "S256", scope: "queqiao:access", resource, state: "run-smoke" })) authorization.searchParams.set(key, value);
const form = new URLSearchParams(authorization.searchParams); form.set("approval_secret", approvalSecret);
const approved = await fetch(new URL("oauth/authorize", base), { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form });
if (approved.status !== 303) throw new Error(`Approval returned ${approved.status}`);
const code = new URL(approved.headers.get("location")).searchParams.get("code");
const token = await json(new URL("oauth/token", base), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: redirectUri, client_id: registration.client_id, code_verifier: verifier, resource }) });
const client = new Client({ name: "queqiao-run-smoke", version: "0.1.0" });
const transport = new StreamableHTTPClientTransport(new URL(resource), { requestInit: { headers: { Authorization: `Bearer ${token.access_token}` } } });
try {
  await client.connect(transport);
  const windows = await client.callTool({ name: "run", arguments: { workspaceId: "exec-validation", executable: "node.exe", args: ["-e", "process.stdout.write(process.platform)"], timeoutMs: 5000 } });
  if (windows.isError || !JSON.stringify(windows.content).includes("win32")) throw new Error(`Windows run failed: ${JSON.stringify(windows.content)}`);
  const denied = await client.callTool({ name: "run", arguments: { workspaceId: "write-validation", executable: "node.exe", args: ["--version"], timeoutMs: 5000 } });
  if (!denied.isError || !JSON.stringify(denied.content).includes("denied")) throw new Error("Editor profile did not deny run");
  const timeout = await client.callTool({ name: "run", arguments: { workspaceId: "exec-validation", executable: "node.exe", args: ["-e", "setInterval(()=>{},1000)"], timeoutMs: 100 } });
  const timeoutText = timeout.content.find((item) => item.type === "text")?.text || "";
  let timeoutValue;
  try { timeoutValue = JSON.parse(timeoutText); } catch { timeoutValue = undefined; }
  if (timeout.isError || timeoutValue?.timedOut !== true) throw new Error(`Public timeout did not terminate the process: ${JSON.stringify(timeout)}`);
  // The same workspace ID cannot exist in two environments, so WSL is verified through
  // its private Worker contract until an environment-qualified workspace handle lands.
  console.log(JSON.stringify({ ok: true, scope: token.scope, windows: windows.content, editorDenied: true, timeoutTerminated: true }, null, 2));
} finally { await transport.close(); }
